import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { ExcelSyncWorker } from '../src/modules/workbooks/sync/excel-sync.worker.js';
import { WorkbookStorageService } from '../src/modules/workbooks/workbook-storage.service.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

interface ListItem {
  id: string;
  taskNumber: number;
  name: string;
  status: string;
  lastEntryDate: string;
  entryCount: number;
  version: number;
  workbook: { id: string; name: string };
  latestDescription: string;
}

interface TaskPage {
  items: ListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Detail extends ListItem {
  updates: {
    id: string;
    entryDate: string;
    status: string;
    description: string;
    version: number;
  }[];
  history: { action: string; changes: Record<string, unknown> }[];
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Task management page (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageRoot: string;
  let cleanup: () => Promise<void>;

  async function signedIn(label: string) {
    const client = await AuthTestClient.create(app);
    await client.register(uniqueEmail(label)).expect(201);
    return client;
  }

  async function workbook(client: AuthTestClient, name: string) {
    return ((await client.post('/api/workbooks', { name }).expect(201)).body as { id: string }).id;
  }

  async function task(
    client: AuthTestClient,
    name: string,
    entryDate: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await client
      .post('/api/tasks', {
        name,
        entryDate,
        description: `${name} work`,
        status: 'IN_PROGRESS',
        ...extra,
      })
      .expect(201);
    return (res.body as { task: ListItem }).task;
  }

  async function list(client: AuthTestClient, query = ''): Promise<TaskPage> {
    return (await client.get(`/api/tasks${query}`).expect(200)).body as TaskPage;
  }

  async function detail(client: AuthTestClient, id: string): Promise<Detail> {
    return (await client.get(`/api/tasks/${id}`).expect(200)).body as Detail;
  }

  /** Task names in the stored Excel file once the queued sync jobs have run. */
  async function excelNames(workbookId: string): Promise<string[]> {
    await app.get(ExcelSyncWorker).drain();
    const row = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
    expect(row.syncedVersion).toBe(row.dataVersion);
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(
      (await readFile(path.join(storageRoot, row.storageKey))) as unknown as ArrayBuffer,
    );
    const names: string[] = [];
    excel.getWorksheet('Daily Tasks')!.eachRow((r, i) => {
      if (i > 1) {
        names.push(r.getCell(3).text);
      }
    });
    return names;
  }

  const del = (client: AuthTestClient, id: string, version: number) =>
    client.agent
      .delete(`/api/tasks/${id}?version=${version}`)
      .set('X-CSRF-Token', client.csrfToken);

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
    storageRoot = app.get(WorkbookStorageService).root;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('listing, search, filters, sorting and pagination', () => {
    let client: AuthTestClient;
    let main: string;
    let apollo: string;

    beforeAll(async () => {
      client = await signedIn('listing');
      main = await workbook(client, 'Main');
      apollo = await workbook(client, 'Apollo');
      // 23 tasks in Main on 1-23 Oct, statuses rotating; 2 in Apollo.
      const statuses = ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD'];
      for (let day = 1; day <= 23; day += 1) {
        await task(
          client,
          `Report ${String(day).padStart(2, '0')}`,
          `2026-10-${String(day).padStart(2, '0')}`,
          {
            status: statuses[day % 5],
          },
        );
      }
      await task(client, 'GST filing 100% done', '2026-11-02', {
        workbookId: apollo,
        status: 'COMPLETED',
      });
      const audit = await task(client, 'Audit_prep', '2026-09-15', { workbookId: apollo });
      // Audit_prep: worked on in September and again on 30 Oct (latest).
      await client
        .post(`/api/tasks/${audit.id}/updates`, {
          entryDate: '2026-10-30',
          description: 'Second pass',
          status: 'PENDING',
        })
        .expect(201);
    });

    it('lists all tasks newest date first, with workbook, status and latest description', async () => {
      const page = await list(client);

      expect(page).toMatchObject({ page: 1, pageSize: 20, total: 25, totalPages: 2 });
      expect(page.items.slice(0, 3).map((t) => [t.name, t.lastEntryDate])).toEqual([
        ['GST filing 100% done', '2026-11-02'],
        ['Audit_prep', '2026-10-30'],
        ['Report 23', '2026-10-23'],
      ]);
      expect(page.items[1]).toMatchObject({
        workbook: { id: apollo, name: 'Apollo' },
        status: 'PENDING',
        entryCount: 2,
        latestDescription: 'Second pass',
      });
    });

    it('paginates without overlap or gaps', async () => {
      const first = await list(client, '?pageSize=10&page=1');
      const second = await list(client, '?pageSize=10&page=2');
      const third = await list(client, '?pageSize=10&page=3');

      expect([first.items.length, second.items.length, third.items.length]).toEqual([10, 10, 5]);
      expect(third.totalPages).toBe(3);
      const ids = [...first.items, ...second.items, ...third.items].map((t) => t.id);
      expect(new Set(ids).size).toBe(25);
      expect((await list(client, '?pageSize=10&page=9')).items).toEqual([]);
    });

    it('searches by name, case-insensitively and as a substring', async () => {
      const page = await list(client, '?search=REPORT%201');
      expect(page.items.map((t) => t.name).sort()).toEqual([
        'Report 10',
        'Report 11',
        'Report 12',
        'Report 13',
        'Report 14',
        'Report 15',
        'Report 16',
        'Report 17',
        'Report 18',
        'Report 19',
      ]);
    });

    it('treats % and _ in the search as plain characters', async () => {
      expect((await list(client, '?search=100%25')).items.map((t) => t.name)).toEqual([
        'GST filing 100% done',
      ]);
      expect((await list(client, '?search=t_p')).items.map((t) => t.name)).toEqual(['Audit_prep']);
      expect((await list(client, '?search=%25')).total).toBe(1);
    });

    it('searches by task number: "#7" exactly, "7" also in names', async () => {
      const exact = await list(client, `?search=%237&workbookId=${main}`);
      expect(exact.items.map((t) => t.taskNumber)).toEqual([7]);

      // Task 7 ("Report 07") and "Report 17" (whose name contains 7).
      const loose = await list(client, `?search=7&workbookId=${main}&sort=number`);
      expect(loose.items.map((t) => t.taskNumber)).toEqual([7, 17]);
    });

    it('filters by status, workbook and date range', async () => {
      const completed = await list(client, '?status=COMPLETED&pageSize=100');
      expect(completed.items.every((t) => t.status === 'COMPLETED')).toBe(true);
      expect(completed.total).toBe(6); // 5 in Main + 1 in Apollo

      const inApollo = await list(client, `?workbookId=${apollo}`);
      expect(inApollo.items.map((t) => t.name)).toEqual(['GST filing 100% done', 'Audit_prep']);

      // Audit_prep matches September through its first update, though its latest date is in October.
      const september = await list(client, '?from=2026-09-01&to=2026-09-30');
      expect(september.items.map((t) => t.name)).toEqual(['Audit_prep']);

      const combined = await list(
        client,
        `?workbookId=${main}&from=2026-10-10&to=2026-10-12&status=PENDING`,
      );
      expect(combined.items.map((t) => t.name)).toEqual(['Report 12']);
    });

    it('sorts by oldest date, task number and name', async () => {
      expect((await list(client, '?sort=oldest')).items[0]?.name).toBe('Report 01');
      const byNumber = await list(client, `?sort=number&workbookId=${main}&pageSize=3`);
      expect(byNumber.items.map((t) => t.taskNumber)).toEqual([1, 2, 3]);
      expect((await list(client, '?sort=name')).items[0]?.name).toBe('Audit_prep');
    });

    it('validates query parameters', async () => {
      const res = await client.get('/api/tasks?from=2026-10-10&to=2026-10-01').expect(400);
      expect(res.body.errors).toEqual([
        { field: 'to', message: 'The end date must be on or after the start date' },
      ]);
      await client.get('/api/tasks?status=DONE').expect(400);
      await client.get('/api/tasks?pageSize=1000').expect(400);
      await client.get('/api/tasks?sort=random').expect(400);
      // Empty parameters mean "no filter".
      expect((await list(client, '?status=&workbookId=&search=&from=&to=')).total).toBe(25);
    });

    it('shows only the signed-in user’s tasks', async () => {
      const other = await signedIn('listing-other');
      await workbook(other, 'Mine');
      await task(other, 'Report 99', '2026-10-01');

      expect((await list(other)).items.map((t) => t.name)).toEqual(['Report 99']);
      await other.get(`/api/tasks?workbookId=${main}`).expect(404);
      expect((await list(client, '?search=Report%2099')).total).toBe(0);
    });
  });

  describe('task detail', () => {
    it('returns the task with its workbook, dated updates and history', async () => {
      const client = await signedIn('detail');
      const wb = await workbook(client, 'Main');
      const created = await task(client, 'Close books', '2026-11-01');
      await client
        .post(`/api/tasks/${created.id}/updates`, {
          entryDate: '2026-11-02',
          description: 'Done',
          status: 'COMPLETED',
        })
        .expect(201);

      const result = await detail(client, created.id);

      expect(result).toMatchObject({
        taskNumber: 1,
        name: 'Close books',
        status: 'COMPLETED',
        lastEntryDate: '2026-11-02',
        workbook: { id: wb, name: 'Main' },
      });
      expect(result.updates.map((u) => [u.entryDate, u.description])).toEqual([
        ['2026-11-02', 'Done'],
        ['2026-11-01', 'Close books work'],
      ]);
      expect(result.history.map((h) => h.action)).toEqual(['TASK_CREATED', 'ENTRY_ADDED']);
    });
  });

  describe('editing', () => {
    it('renames a task, records it in the history and updates its Excel rows', async () => {
      const client = await signedIn('rename');
      const wb = await workbook(client, 'Main');
      const created = await task(client, 'Draft name', '2026-11-01');

      const res = await client
        .patch(`/api/tasks/${created.id}`, { name: 'Final name', version: created.version })
        .expect(200);

      expect(res.body).toMatchObject({
        task: { name: 'Final name', version: created.version + 1 },
        excelSync: { status: 'queued', jobId: expect.any(String) },
      });
      const history = (await detail(client, created.id)).history;
      expect(history.at(-1)).toMatchObject({
        action: 'TASK_RENAMED',
        changes: { name: { from: 'Draft name', to: 'Final name' } },
      });
      expect(await excelNames(wb)).toEqual(['Final name']);
      // The new name is what duplicate detection now uses.
      await client
        .post('/api/tasks', {
          name: 'final NAME',
          entryDate: '2026-11-02',
          description: 'x',
          status: 'TO_DO',
        })
        .expect(409);
    });

    it('rejects a name used by another task in the workbook, and stale versions', async () => {
      const client = await signedIn('rename-conflict');
      await workbook(client, 'Main');
      const a = await task(client, 'Alpha', '2026-11-01');
      await task(client, 'Beta', '2026-11-01');

      const taken = await client
        .patch(`/api/tasks/${a.id}`, { name: 'beta', version: a.version })
        .expect(409);
      expect(taken.body.code).toBe('TASK_NAME_TAKEN');

      await client.patch(`/api/tasks/${a.id}`, { name: 'Alpha 2', version: a.version }).expect(200);
      const stale = await client
        .patch(`/api/tasks/${a.id}`, { name: 'Alpha 3', version: a.version })
        .expect(409);
      expect(stale.body.code).toBe('TASK_VERSION_CONFLICT');
    });

    it('adding or editing a dated update changes the task version', async () => {
      const client = await signedIn('version');
      await workbook(client, 'Main');
      const created = await task(client, 'Versioned', '2026-11-01');

      await client
        .post(`/api/tasks/${created.id}/updates`, {
          entryDate: '2026-11-02',
          description: 'Next',
          status: 'TO_DO',
        })
        .expect(201);

      expect((await detail(client, created.id)).version).toBe(created.version + 1);
      // A delete based on the old version is refused: the user has not seen the new update.
      expect((await del(client, created.id, created.version).expect(409)).body.code).toBe(
        'TASK_VERSION_CONFLICT',
      );
    });
  });

  describe('deleting', () => {
    it('removes the task from lists and Excel but keeps it, its updates and its audit trail', async () => {
      const client = await signedIn('delete');
      const wb = await workbook(client, 'Main');
      const keep = await task(client, 'Keep me', '2026-11-01');
      const doomed = await task(client, 'Delete me', '2026-11-01');
      await client
        .post(`/api/tasks/${doomed.id}/updates`, {
          entryDate: '2026-11-02',
          description: 'More',
          status: 'PENDING',
        })
        .expect(201);
      const version = (await detail(client, doomed.id)).version;

      const res = await del(client, doomed.id, version).expect(200);

      expect(res.body).toEqual({
        taskId: doomed.id,
        excelSync: { workbookId: wb, status: 'queued', jobId: expect.any(String) },
      });
      expect((await list(client)).items.map((t) => t.id)).toEqual([keep.id]);
      await client.get(`/api/tasks/${doomed.id}`).expect(404);
      expect(await excelNames(wb)).toEqual(['Keep me']);
      expect((await client.get(`/api/workbooks/${wb}`)).body.taskCount).toBe(1);

      // Audit information is preserved in PostgreSQL.
      const stored = await prisma.task.findUniqueOrThrow({
        where: { id: doomed.id },
        include: { updates: true, history: { orderBy: { createdAt: 'asc' } } },
      });
      expect(stored.deletedAt).not.toBeNull();
      expect(stored.nameKey).toBeNull();
      expect(stored.updates).toHaveLength(2);
      expect(stored.history.map((h) => h.action)).toEqual([
        'TASK_CREATED',
        'ENTRY_ADDED',
        'TASK_DELETED',
      ]);
      expect(stored.history[2]?.changes).toEqual({
        taskNumber: 2,
        name: 'Delete me',
        workbookId: wb,
        status: 'PENDING',
        lastEntryDate: '2026-11-02',
        entryCount: 2,
      });
    });

    it('frees the name but never reuses the task number', async () => {
      const client = await signedIn('delete-reuse');
      await workbook(client, 'Main');
      const first = await task(client, 'Recurring', '2026-11-01');
      await del(client, first.id, first.version).expect(200);

      const again = await task(client, 'Recurring', '2026-11-02');

      expect(again.taskNumber).toBe(2);
      expect(again.id).not.toBe(first.id);
    });

    it('cannot change or re-delete a deleted task, and others cannot delete it', async () => {
      const client = await signedIn('delete-guards');
      await workbook(client, 'Main');
      const created = await task(client, 'Guarded', '2026-11-01');
      const other = await signedIn('delete-intruder');

      await del(other, created.id, created.version).expect(404);
      await del(client, created.id, created.version).expect(200);

      await del(client, created.id, created.version + 1).expect(404);
      await client
        .patch(`/api/tasks/${created.id}`, { name: 'Zombie', version: created.version + 1 })
        .expect(404);
      await client
        .post(`/api/tasks/${created.id}/updates`, {
          entryDate: '2026-11-03',
          description: 'x',
          status: 'TO_DO',
        })
        .expect(404);
      await client
        .get(`/api/tasks/recent-updates`)
        .expect(200)
        .expect(({ body }) => {
          expect((body as { updates: unknown[] }).updates).toEqual([]);
        });
    });

    it('never lets a concurrent update and delete both succeed', async () => {
      const client = await signedIn('delete-race');
      const wb = await workbook(client, 'Main');
      const created = await task(client, 'Contested', '2026-11-01');

      const [deleted, added] = await Promise.all([
        del(client, created.id, created.version),
        client.post(`/api/tasks/${created.id}/updates`, {
          entryDate: '2026-11-02',
          description: 'Racing',
          status: 'TO_DO',
        }),
      ]);

      const outcome = [deleted.status, added.status].sort().join(',');
      expect(['200,404', '201,409']).toContain(outcome);
      const stored = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
      expect(await excelNames(wb)).toEqual(stored.deletedAt ? [] : ['Contested', 'Contested']);
    });
  });
});
