import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { WorkbookStorageService } from '../src/modules/workbooks/workbook-storage.service.js';
import { ExcelSyncWorker } from '../src/modules/workbooks/sync/excel-sync.worker.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

interface TaskDto {
  id: string;
  workbookId: string;
  taskNumber: number;
  name: string;
  status: string;
  lastEntryDate: string;
  entryCount: number;
}

interface UpdateDto {
  id: string;
  taskId: string;
  entryDate: string;
  status: string;
  description: string;
  reference: string | null;
  version: number;
}

interface SaveResult {
  task: TaskDto;
  update: UpdateDto;
  excelSync: { workbookId: string; status: string; jobId: string | null };
}

interface ExcelRow {
  number: unknown;
  date: string;
  name: unknown;
  description: unknown;
  reference: unknown;
  status: unknown;
}

const BASE_TASK = {
  name: 'Prepare GST report',
  entryDate: '2026-11-05',
  description: 'Collected invoices for October.',
  reference: 'https://docs.example.com/gst',
  status: 'IN_PROGRESS',
};

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Daily task management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageRoot: string;
  let cleanup: () => Promise<void>;

  async function signedIn(label = 'tasks') {
    const client = await AuthTestClient.create(app);
    const res = await client.register(uniqueEmail(label)).expect(201);
    return { client, userId: (res.body as { user: { id: string } }).user.id };
  }

  async function workbook(client: AuthTestClient, name: string, makeDefault = false) {
    const res = await client.post('/api/workbooks', { name, makeDefault }).expect(201);
    return (res.body as { id: string }).id;
  }

  /** A signed-in user with one (default) workbook. */
  async function userWithWorkbook(label = 'tasks') {
    const user = await signedIn(label);
    return { ...user, workbookId: await workbook(user.client, 'Daily Tasks') };
  }

  const createTask = (client: AuthTestClient, body: object) =>
    client.post('/api/tasks', { ...BASE_TASK, ...body });

  /** Runs the queued Excel sync jobs (the background worker is disabled in e2e tests). */
  const drain = () => app.get(ExcelSyncWorker).drain();

  /**
   * Rows of the stored Excel file after processing the queued jobs, read from disk (not
   * through the download endpoint).
   */
  async function excelRows(workbookId: string): Promise<ExcelRow[]> {
    await drain();
    const row = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(
      (await readFile(path.join(storageRoot, row.storageKey))) as unknown as ArrayBuffer,
    );
    const rows: ExcelRow[] = [];
    excel.getWorksheet('Daily Tasks')!.eachRow((excelRow, index) => {
      if (index === 1) {
        return;
      }
      const values = excelRow.values as unknown[];
      const reference = values[5] as { text?: string } | string | undefined;
      rows.push({
        number: values[1],
        date: (values[2] as Date).toISOString().slice(0, 10),
        name: values[3],
        description: values[4],
        reference: typeof reference === 'object' ? reference.text : reference,
        status: values[6],
      });
    });
    return rows;
  }

  async function expectInSync(workbookId: string) {
    await drain();
    const row = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
    expect(row.syncedVersion).toBe(row.dataVersion);
    expect(row.syncError).toBeNull();
  }

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
    storageRoot = app.get(WorkbookStorageService).root;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('creating tasks', () => {
    it('creates a numbered task in the default workbook, records history and syncs Excel', async () => {
      const { client, workbookId } = await userWithWorkbook('create');

      const res = await createTask(client, {}).expect(201);
      const result = res.body as SaveResult;

      expect(result.task).toMatchObject({
        workbookId,
        taskNumber: 1,
        name: 'Prepare GST report',
        status: 'IN_PROGRESS',
        lastEntryDate: '2026-11-05',
        entryCount: 1,
      });
      expect(result.update).toMatchObject({
        entryDate: '2026-11-05',
        status: 'IN_PROGRESS',
        description: 'Collected invoices for October.',
        reference: 'https://docs.example.com/gst',
        version: 1,
      });
      // Saved in PostgreSQL; the Excel file is written by the queued job afterwards.
      expect(result.excelSync).toEqual({ workbookId, status: 'queued', jobId: expect.any(String) });
      expect(
        await prisma.excelSyncJob.findUniqueOrThrow({ where: { id: result.excelSync.jobId! } }),
      ).toMatchObject({
        workbookId,
        taskId: result.task.id,
        reason: 'TASK_CREATED',
        status: 'PENDING',
        targetDataVersion: 1,
      });
      expect((await client.get(`/api/workbooks/${workbookId}`)).body.syncStatus).toBe('pending');

      const history = await prisma.taskHistory.findMany({ where: { taskId: result.task.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ action: 'TASK_CREATED', taskUpdateId: result.update.id });

      await expectInSync(workbookId);
      expect(await excelRows(workbookId)).toEqual([
        {
          number: 1,
          date: '2026-11-05',
          name: 'Prepare GST report',
          description: 'Collected invoices for October.',
          reference: 'https://docs.example.com/gst',
          status: 'In Progress',
        },
      ]);
      const wb = (await client.get(`/api/workbooks/${workbookId}`)).body as {
        taskCount: number;
        nextTaskNumber: number;
        syncStatus: string;
      };
      expect(wb).toMatchObject({ taskCount: 1, nextTaskNumber: 2, syncStatus: 'synced' });
    });

    it('numbers tasks sequentially per workbook', async () => {
      const { client, workbookId } = await userWithWorkbook('numbers');
      const other = await workbook(client, 'Other');

      const numbers = [];
      for (const name of ['A', 'B', 'C']) {
        numbers.push(
          ((await createTask(client, { name }).expect(201)).body as SaveResult).task.taskNumber,
        );
      }
      const inOther = (await createTask(client, { name: 'A', workbookId: other }).expect(201))
        .body as SaveResult;

      expect(numbers).toEqual([1, 2, 3]);
      expect(inOther.task).toMatchObject({ workbookId: other, taskNumber: 1 });
      expect((await excelRows(workbookId)).map((r) => r.number)).toEqual([1, 2, 3]);
    });

    it('validates input', async () => {
      const { client } = await userWithWorkbook('validate');

      const res = await client
        .post('/api/tasks', {
          name: ' ',
          entryDate: '2026-02-30',
          description: '',
          reference: 'javascript:alert(1)',
          status: 'DONE',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((res.body.errors as { field: string }[]).map((e) => e.field).sort()).toEqual([
        'description',
        'entryDate',
        'name',
        'reference',
        'status',
      ]);
      await createTask(client, { taskNumber: 42 }).expect(400);
    });
  });

  describe('duplicate detection', () => {
    it('detects an existing task name (case- and space-insensitive) without creating anything', async () => {
      const { client, workbookId } = await userWithWorkbook('dup');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;

      const res = await createTask(client, {
        name: '  prepare   GST REPORT ',
        entryDate: '2026-11-06',
      }).expect(409);

      expect(res.body).toMatchObject({
        code: 'TASK_ALREADY_EXISTS',
        message: 'This task already exists. What would you like to do?',
        details: {
          task: { id: original.task.id, taskNumber: 1 },
          workbookName: 'Daily Tasks',
          targetUpdate: { id: original.update.id, entryDate: '2026-11-05' },
          hasUpdateOnDate: false,
        },
      });
      expect(await prisma.task.count({ where: { workbookId } })).toBe(1);
      const wb = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
      expect(wb).toMatchObject({ taskCount: 1, lastTaskNumber: 1 });
    });

    it('offers the lookup before submitting', async () => {
      const { client, workbookId } = await userWithWorkbook('lookup');
      await createTask(client, {}).expect(201);

      const found = await client
        .get(
          `/api/tasks/lookup?workbookId=${workbookId}&name=PREPARE%20gst%20report&entryDate=2026-11-05`,
        )
        .expect(200);
      expect(found.body.match).toMatchObject({ task: { taskNumber: 1 }, hasUpdateOnDate: true });

      const none = await client.get('/api/tasks/lookup?name=Something%20else').expect(200);
      expect(none.body).toEqual({ match: null });
    });

    it('treats the same name in a different workbook as a different task', async () => {
      const { client, workbookId } = await userWithWorkbook('cross-wb');
      const second = await workbook(client, 'Project Apollo');
      await createTask(client, {}).expect(201);

      const res = await createTask(client, { workbookId: second }).expect(201);

      expect((res.body as SaveResult).task).toMatchObject({ workbookId: second, taskNumber: 1 });
      expect(await excelRows(workbookId)).toHaveLength(1);
      expect(await excelRows(second)).toHaveLength(1);
    });
  });

  describe('repeated daily tasks and updates', () => {
    it('"Create New Daily Task Entry" adds a dated update linked to the original task', async () => {
      const { client, workbookId } = await userWithWorkbook('repeat');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;

      const res = await client
        .post(`/api/tasks/${original.task.id}/updates`, {
          entryDate: '2026-11-06',
          description: 'Filed the return.',
          reference: '',
          status: 'COMPLETED',
        })
        .expect(201);
      const repeat = res.body as SaveResult;

      expect(repeat.update.id).not.toBe(original.update.id);
      expect(repeat.update).toMatchObject({
        taskId: original.task.id,
        entryDate: '2026-11-06',
        status: 'COMPLETED',
      });
      expect(repeat.task).toMatchObject({
        id: original.task.id,
        taskNumber: 1,
        status: 'COMPLETED',
        lastEntryDate: '2026-11-06',
        entryCount: 2,
      });

      // The historical update is untouched.
      const first = await prisma.taskUpdate.findUniqueOrThrow({
        where: { id: original.update.id },
      });
      expect(first).toMatchObject({
        status: 'IN_PROGRESS',
        description: 'Collected invoices for October.',
        version: 1,
      });

      const rows = await excelRows(workbookId);
      expect(rows.map((r) => [r.number, r.date, r.status])).toEqual([
        [1, '2026-11-05', 'In Progress'],
        [1, '2026-11-06', 'Completed'],
      ]);
      const history = await prisma.taskHistory.findMany({
        where: { taskId: original.task.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => h.action)).toEqual(['TASK_CREATED', 'ENTRY_ADDED']);
    });

    it('allows only one entry per task and date', async () => {
      const { client } = await userWithWorkbook('same-date');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;

      const res = await client
        .post(`/api/tasks/${original.task.id}/updates`, {
          entryDate: '2026-11-05',
          description: 'Again',
          status: 'PENDING',
        })
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'TASK_UPDATE_EXISTS_FOR_DATE',
        details: { existingUpdate: { id: original.update.id } },
      });
    });

    it('keeps the latest date as the task status when back-filling an older day', async () => {
      const { client } = await userWithWorkbook('backfill');
      const original = (
        await createTask(client, { entryDate: '2026-11-06', status: 'COMPLETED' }).expect(201)
      ).body as SaveResult;

      const res = await client
        .post(`/api/tasks/${original.task.id}/updates`, {
          entryDate: '2026-11-01',
          description: 'Started',
          status: 'TO_DO',
        })
        .expect(201);

      expect((res.body as SaveResult).task).toMatchObject({
        status: 'COMPLETED',
        lastEntryDate: '2026-11-06',
      });
    });

    it('"Update Existing Task" edits one entry, keeps the old values in history and updates Excel', async () => {
      const { client, workbookId } = await userWithWorkbook('edit');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;
      await client
        .post(`/api/tasks/${original.task.id}/updates`, {
          entryDate: '2026-11-06',
          description: 'Day two',
          status: 'IN_PROGRESS',
        })
        .expect(201);

      const res = await client
        .patch(`/api/tasks/${original.task.id}/updates/${original.update.id}`, {
          description: 'Collected and verified invoices.',
          reference: null,
          status: 'PENDING',
          version: 1,
        })
        .expect(200);

      expect((res.body as SaveResult).update).toMatchObject({
        id: original.update.id,
        entryDate: '2026-11-05',
        status: 'PENDING',
        description: 'Collected and verified invoices.',
        reference: null,
        version: 2,
      });
      const edit = await prisma.taskHistory.findFirstOrThrow({
        where: { taskUpdateId: original.update.id, action: 'ENTRY_UPDATED' },
      });
      expect(edit.changes).toEqual({
        entryDate: '2026-11-05',
        status: { from: 'IN_PROGRESS', to: 'PENDING' },
        description: {
          from: 'Collected invoices for October.',
          to: 'Collected and verified invoices.',
        },
        reference: { from: 'https://docs.example.com/gst', to: null },
      });
      expect((await excelRows(workbookId)).map((r) => [r.date, r.status, r.description])).toEqual([
        ['2026-11-05', 'Pending', 'Collected and verified invoices.'],
        ['2026-11-06', 'In Progress', 'Day two'],
      ]);

      // A stale version is rejected.
      const stale = await client
        .patch(`/api/tasks/${original.task.id}/updates/${original.update.id}`, {
          description: 'Overwrite',
          status: 'COMPLETED',
          version: 1,
        })
        .expect(409);
      expect(stale.body).toMatchObject({
        code: 'TASK_UPDATE_VERSION_CONFLICT',
        details: { current: { version: 2 } },
      });
    });

    it('returns a task with its updates (newest first) and history', async () => {
      const { client } = await userWithWorkbook('detail');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;
      await client
        .post(`/api/tasks/${original.task.id}/updates`, {
          entryDate: '2026-11-06',
          description: 'Next',
          status: 'COMPLETED',
        })
        .expect(201);

      const detail = (await client.get(`/api/tasks/${original.task.id}`).expect(200)).body as {
        updates: UpdateDto[];
        history: { action: string }[];
      };

      expect(detail.updates.map((u) => u.entryDate)).toEqual(['2026-11-06', '2026-11-05']);
      expect(detail.history.map((h) => h.action)).toEqual(['TASK_CREATED', 'ENTRY_ADDED']);
      const recent = await client.get('/api/tasks/recent-updates?limit=1').expect(200);
      expect(recent.body.updates).toEqual([
        expect.objectContaining({
          entryDate: '2026-11-06',
          taskNumber: 1,
          taskName: 'Prepare GST report',
        }),
      ]);
    });

    it('recovers a workbook whose Excel sync is behind (manual resync and startup recovery)', async () => {
      const { client, workbookId } = await userWithWorkbook('resync');
      await createTask(client, {}).expect(201);
      await expectInSync(workbookId);
      // Simulate a lost sync: a committed change without a job, not in the file yet.
      await prisma.taskUpdate.updateMany({
        where: { task: { workbookId } },
        data: { description: 'Changed while the sync was failing' },
      });
      await prisma.workbook.update({
        where: { id: workbookId },
        data: { dataVersion: { increment: 1 } },
      });
      expect((await client.get(`/api/workbooks/${workbookId}`)).body.syncStatus).toBe('pending');

      const resync = await client.post(`/api/workbooks/${workbookId}/sync`).expect(202);

      expect(resync.body).toMatchObject({ workbookId, state: 'pending', pendingJobs: 1 });
      expect((await excelRows(workbookId))[0]?.description).toBe(
        'Changed while the sync was failing',
      );
      expect((await client.get(`/api/workbooks/${workbookId}/sync-status`)).body).toMatchObject({
        state: 'synced',
        pendingJobs: 0,
      });

      // Startup recovery queues a job for anything still behind without a job.
      await prisma.workbook.update({
        where: { id: workbookId },
        data: { dataVersion: { increment: 1 } },
      });
      expect(await app.get(ExcelSyncWorker).recoverOrphans()).toBeGreaterThanOrEqual(1);
      expect(await prisma.excelSyncJob.count({ where: { workbookId, reason: 'RECOVERY' } })).toBe(
        1,
      );
      await expectInSync(workbookId);
    });

    it('protects the audit trail from modification', async () => {
      const { client } = await userWithWorkbook('audit');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;

      await expect(
        prisma.$executeRaw`UPDATE task_history SET changes = '{}' WHERE task_id = ${original.task.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('workbook selection', () => {
    it('uses the default workbook when none is given, and the chosen one otherwise', async () => {
      const { client, workbookId } = await userWithWorkbook('select');
      const apollo = await workbook(client, 'Apollo', true);

      const toDefault = (await createTask(client, { name: 'X' }).expect(201)).body as SaveResult;
      const chosen = (await createTask(client, { name: 'Y', workbookId }).expect(201))
        .body as SaveResult;

      expect(toDefault.task.workbookId).toBe(apollo);
      expect(chosen.task.workbookId).toBe(workbookId);
    });

    it('asks the user to choose when several workbooks exist and none is the default', async () => {
      const { client, userId } = await userWithWorkbook('choose');
      await workbook(client, 'Second');
      await prisma.user.update({ where: { id: userId }, data: { defaultWorkbookId: null } });

      const res = await createTask(client, {}).expect(400);
      expect(res.body.code).toBe('WORKBOOK_SELECTION_REQUIRED');
    });

    it('requires a workbook to exist', async () => {
      const { client } = await signedIn('no-wb');
      expect((await createTask(client, {}).expect(400)).body.code).toBe('NO_WORKBOOK');
    });
  });

  describe('authorization', () => {
    it('keeps every user’s tasks private', async () => {
      const alice = await userWithWorkbook('alice');
      const bob = await userWithWorkbook('bob');
      const task = (await createTask(alice.client, {}).expect(201)).body as SaveResult;

      await bob.client.get(`/api/tasks/${task.task.id}`).expect(404);
      await bob.client
        .post(`/api/tasks/${task.task.id}/updates`, {
          entryDate: '2026-11-06',
          description: 'x',
          status: 'TO_DO',
        })
        .expect(404);
      await bob.client
        .patch(`/api/tasks/${task.task.id}/updates/${task.update.id}`, {
          description: 'Hacked',
          status: 'COMPLETED',
          version: 1,
        })
        .expect(404);
      // Bob cannot add tasks to Alice's workbook either.
      await createTask(bob.client, { workbookId: alice.workbookId, name: 'Intrusion' }).expect(404);
      await bob.client.get(`/api/tasks?workbookId=${alice.workbookId}`).expect(404);

      // Duplicate detection only looks at Bob's own data.
      await createTask(bob.client, {}).expect(201);
      expect(
        (await bob.client.get('/api/tasks/recent-updates').expect(200)).body.updates,
      ).toHaveLength(1);
      expect(await excelRows(alice.workbookId)).toHaveLength(1);

      const anonymous = await AuthTestClient.create(app);
      await anonymous.get('/api/tasks').expect(401);
      await anonymous.post('/api/tasks', BASE_TASK).expect(401);
    });
  });

  describe('concurrent submissions', () => {
    it('creates one task when the same new task is submitted concurrently', async () => {
      const { client, workbookId } = await userWithWorkbook('race-same');

      const results = await Promise.all(Array.from({ length: 5 }, () => createTask(client, {})));

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(
        results.filter((r) => r.status === 409).every((r) => r.body.code === 'TASK_ALREADY_EXISTS'),
      ).toBe(true);
      expect(await prisma.task.count({ where: { workbookId } })).toBe(1);
      expect(await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } })).toMatchObject({
        taskCount: 1,
        lastTaskNumber: 1,
      });
      await expectInSync(workbookId);
      expect(await excelRows(workbookId)).toHaveLength(1);
    });

    it('hands out unique task numbers and syncs every row under concurrent creation', async () => {
      const { client, workbookId } = await userWithWorkbook('race-many');

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => createTask(client, { name: `Task ${i}` })),
      );

      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results
        .map((r) => (r.body as SaveResult).task.taskNumber)
        .sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      await expectInSync(workbookId);
      const rows = await excelRows(workbookId);
      expect(rows.map((r) => r.number).sort((a, b) => Number(a) - Number(b))).toEqual(numbers);
    });

    it('accepts one daily entry when the same date is submitted concurrently', async () => {
      const { client } = await userWithWorkbook('race-entry');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;

      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          client.post(`/api/tasks/${original.task.id}/updates`, {
            entryDate: '2026-11-06',
            description: `Attempt ${i}`,
            status: 'IN_PROGRESS',
          }),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: original.task.id } });
      expect(task.entryCount).toBe(2);
    });

    it('lets only one of two concurrent edits of the same version win', async () => {
      const { client } = await userWithWorkbook('race-edit');
      const original = (await createTask(client, {}).expect(201)).body as SaveResult;
      const url = `/api/tasks/${original.task.id}/updates/${original.update.id}`;

      const [a, b] = await Promise.all([
        client.patch(url, { description: 'From tab A', status: 'COMPLETED', version: 1 }),
        client.patch(url, { description: 'From tab B', status: 'PENDING', version: 1 }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const edits = await prisma.taskHistory.count({
        where: { taskUpdateId: original.update.id, action: 'ENTRY_UPDATED' },
      });
      expect(edits).toBe(1);
    });

    it('keeps several workbooks consistent under concurrent submissions', async () => {
      const { client, workbookId } = await userWithWorkbook('race-wbs');
      const second = await workbook(client, 'Second');

      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          createTask(client, {
            name: `Shared ${i % 3}`,
            workbookId: i % 2 === 0 ? workbookId : second,
          }),
        ),
      );

      for (const id of [workbookId, second]) {
        await expectInSync(id);
        const tasks = await prisma.task.count({ where: { workbookId: id } });
        expect(await excelRows(id)).toHaveLength(tasks);
      }
    });
  });
});
