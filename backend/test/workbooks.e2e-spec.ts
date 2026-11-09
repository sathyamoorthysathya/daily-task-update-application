import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { WorkbookStorageService } from '../src/modules/workbooks/workbook-storage.service.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

interface Workbook {
  id: string;
  name: string;
  isDefault: boolean;
  taskCount: number;
  sizeBytes: number;
  version: number;
  createdAt: string;
}

interface WorkbookList {
  workbooks: Workbook[];
  defaultWorkbookId: string | null;
  limit: number;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Collects a binary response body (supertest buffers only known binary types by default). */
function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Workbook management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageRoot: string;
  let cleanup: () => Promise<void>;

  async function signedIn(label = 'wb') {
    const client = await AuthTestClient.create(app);
    const res = await client.register(uniqueEmail(label)).expect(201);
    return { client, userId: (res.body as { user: { id: string } }).user.id };
  }

  function create(client: AuthTestClient, name: string, extra: object = {}) {
    return client.post('/api/workbooks', { name, ...extra });
  }

  async function list(client: AuthTestClient): Promise<WorkbookList> {
    return (await client.get('/api/workbooks').expect(200)).body as WorkbookList;
  }

  function download(client: AuthTestClient, id: string) {
    return client.agent.get(`/api/workbooks/${id}/download`).buffer(true).parse(binary);
  }

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
    storageRoot = app.get(WorkbookStorageService).root;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('first-time setup and creation', () => {
    it('starts with no workbooks', async () => {
      const { client } = await signedIn('first');
      expect(await list(client)).toEqual({ workbooks: [], defaultWorkbookId: null, limit: 5 });
    });

    it('creates the first workbook as the default, with the file on disk and metadata in PostgreSQL', async () => {
      const { client, userId } = await signedIn('create');

      const res = await create(client, '  My   Daily Tasks ').expect(201);
      const workbook = res.body as Workbook;

      expect(workbook).toMatchObject({
        name: 'My Daily Tasks',
        isDefault: true,
        taskCount: 0,
        version: 1,
      });
      expect(Date.now() - new Date(workbook.createdAt).getTime()).toBeLessThan(60_000);

      // Metadata row: UUID-based path, size and checksum; no file bytes in the database.
      const row = await prisma.workbook.findUniqueOrThrow({ where: { id: workbook.id } });
      expect(row.userId).toBe(userId);
      expect(row.storageKey).toBe(`${userId}/${workbook.id}.xlsx`);
      expect(Object.keys(row)).not.toContain('data');
      const columns = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns WHERE table_name = 'workbooks'`;
      expect(columns.map((c) => c.data_type)).not.toContain('bytea');

      // The file exists in persistent storage and matches the metadata.
      const filePath = path.join(storageRoot, userId, `${workbook.id}.xlsx`);
      const bytes = await readFile(filePath);
      expect(bytes.length).toBe(row.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).defaultWorkbookId,
      ).toBe(workbook.id);
    });

    it('validates names and rejects duplicates case-insensitively', async () => {
      const { client } = await signedIn('names');
      await create(client, 'Reports').expect(201);

      const dup = await create(client, 'REPORTS').expect(409);
      expect(dup.body.code).toBe('WORKBOOK_NAME_TAKEN');

      const invalid = await create(client, '../../etc/passwd').expect(400);
      expect(invalid.body.code).toBe('VALIDATION_FAILED');
      await create(client, '').expect(400);
      await create(client, 'ok', { storageKey: '../evil' }).expect(400);
    });

    it('enforces the per-user workbook limit', async () => {
      const { client } = await signedIn('limit');
      for (let i = 1; i <= 5; i += 1) {
        await create(client, `Workbook ${i}`).expect(201);
      }
      const res = await create(client, 'One too many').expect(409);
      expect(res.body.code).toBe('WORKBOOK_LIMIT_REACHED');
    });
  });

  describe('download', () => {
    it('downloads a valid Excel file with the Daily Tasks sheet', async () => {
      const { client } = await signedIn('download');
      const workbook = (await create(client, 'Q1 Tasks & Notes (Café)').expect(201))
        .body as Workbook;

      const res = await download(client, workbook.id).expect(200);

      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="Q1 Tasks & Notes (Caf_).xlsx"; filename*=UTF-8''Q1%20Tasks%20%26%20Notes%20%28Caf%C3%A9%29.xlsx`,
      );
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      const excel = new ExcelJS.Workbook();
      await excel.xlsx.load(res.body as ArrayBuffer);
      const sheet = excel.getWorksheet('Daily Tasks')!;
      expect(sheet.getRow(1).values).toEqual([
        undefined,
        'Task Number',
        'Date',
        'Task Name',
        'Task Description',
        'Documentation Link / Reference',
        'Status',
        'Task ID (internal)',
        'Task Update ID (internal)',
      ]);
      expect(sheet.getColumn(7).hidden).toBe(true);
      expect(sheet.getColumn(8).hidden).toBe(true);
      expect(sheet.autoFilter).toBe('A1:F1');
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.getRow(1).getCell(1).font).toMatchObject({ bold: true });
    });

    it('never serves a file modified or removed outside the application; it is rebuilt from the database', async () => {
      const { client, userId } = await signedIn('tamper');
      const workbook = (await create(client, 'Tampered').expect(201)).body as Workbook;
      const filePath = path.join(storageRoot, userId, `${workbook.id}.xlsx`);

      for (const damage of [
        () => writeFile(filePath, 'not the original file'),
        () => rm(filePath),
      ]) {
        await damage();
        const res = await download(client, workbook.id).expect(200);
        const excel = new ExcelJS.Workbook();
        await excel.xlsx.load(res.body as ArrayBuffer);
        expect(excel.getWorksheet('Daily Tasks')?.getRow(1).getCell(1).value).toBe('Task Number');
        // The rebuilt file is what is stored now, and it matches the metadata again.
        const row = await prisma.workbook.findUniqueOrThrow({ where: { id: workbook.id } });
        expect(
          createHash('sha256')
            .update(await readFile(filePath))
            .digest('hex'),
        ).toBe(row.sha256);
      }
    });
  });

  describe('multiple workbooks', () => {
    it('lists workbooks oldest first with name, creation date and task count', async () => {
      const { client } = await signedIn('list');
      await create(client, 'First').expect(201);
      await create(client, 'Second').expect(201);

      const result = await list(client);

      expect(result.workbooks.map((w) => [w.name, w.isDefault, w.taskCount])).toEqual([
        ['First', true, 0],
        ['Second', false, 0],
      ]);
      expect(result.workbooks.every((w) => typeof w.createdAt === 'string')).toBe(true);
    });

    it('creates an additional workbook as the new default when asked', async () => {
      const { client } = await signedIn('make-default');
      await create(client, 'Old').expect(201);
      const second = (await create(client, 'New', { makeDefault: true }).expect(201))
        .body as Workbook;

      expect(second.isDefault).toBe(true);
      expect((await list(client)).defaultWorkbookId).toBe(second.id);
    });

    it('renames with optimistic locking and keeps the file', async () => {
      const { client } = await signedIn('rename');
      const workbook = (await create(client, 'Draft').expect(201)).body as Workbook;
      await create(client, 'Taken').expect(201);

      const renamed = await client
        .patch(`/api/workbooks/${workbook.id}`, { name: 'Final', version: 1 })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Final', version: 2 });

      const stale = await client
        .patch(`/api/workbooks/${workbook.id}`, { name: 'Other', version: 1 })
        .expect(409);
      expect(stale.body).toMatchObject({
        code: 'WORKBOOK_VERSION_CONFLICT',
        details: { currentVersion: 2 },
      });

      const taken = await client
        .patch(`/api/workbooks/${workbook.id}`, { name: 'taken', version: 2 })
        .expect(409);
      expect(taken.body.code).toBe('WORKBOOK_NAME_TAKEN');

      // The download uses the new name; the file itself is unchanged.
      const file = await download(client, workbook.id).expect(200);
      expect(file.headers['content-disposition']).toContain('filename="Final.xlsx"');
    });

    it('selects the default workbook', async () => {
      const { client } = await signedIn('default');
      await create(client, 'A').expect(201);
      const b = (await create(client, 'B').expect(201)).body as Workbook;

      const result = (await client.post(`/api/workbooks/${b.id}/default`).expect(200))
        .body as WorkbookList;

      expect(result.defaultWorkbookId).toBe(b.id);
      expect(result.workbooks.find((w) => w.id === b.id)?.isDefault).toBe(true);
    });

    it('deletes a workbook and its file; deleting the default promotes the oldest remaining one', async () => {
      const { client, userId } = await signedIn('delete');
      const a = (await create(client, 'A').expect(201)).body as Workbook;
      const b = (await create(client, 'B').expect(201)).body as Workbook;
      const c = (await create(client, 'C').expect(201)).body as Workbook;
      await client.post(`/api/workbooks/${c.id}/default`).expect(200);

      await client.agent
        .delete(`/api/workbooks/${c.id}?version=1`)
        .set('X-CSRF-Token', client.csrfToken)
        .expect(204);

      const result = await list(client);
      expect(result.workbooks.map((w) => w.id)).toEqual([a.id, b.id]);
      expect(result.defaultWorkbookId).toBe(a.id);
      await expect(stat(path.join(storageRoot, userId, `${c.id}.xlsx`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await client.get(`/api/workbooks/${c.id}`).expect(404);
    });

    it('refuses to delete a workbook that changed since it was shown', async () => {
      const { client } = await signedIn('delete-stale');
      const workbook = (await create(client, 'Mine').expect(201)).body as Workbook;
      await client
        .patch(`/api/workbooks/${workbook.id}`, { name: 'Renamed', version: 1 })
        .expect(200);

      await client.agent
        .delete(`/api/workbooks/${workbook.id}?version=1`)
        .set('X-CSRF-Token', client.csrfToken)
        .expect(409);
      await client.get(`/api/workbooks/${workbook.id}`).expect(200);
    });

    it('leaves no default after the last workbook is deleted', async () => {
      const { client } = await signedIn('delete-last');
      const only = (await create(client, 'Only').expect(201)).body as Workbook;

      await client.agent
        .delete(`/api/workbooks/${only.id}`)
        .set('X-CSRF-Token', client.csrfToken)
        .expect(204);

      expect(await list(client)).toMatchObject({ workbooks: [], defaultWorkbookId: null });
    });
  });

  describe('concurrency protection', () => {
    it('creates only one workbook when the same name is submitted concurrently', async () => {
      const { client } = await signedIn('race-name');

      const results = await Promise.all(
        Array.from({ length: 5 }, () => create(client, 'Same name')),
      );

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect((await list(client)).workbooks).toHaveLength(1);
    });

    it('never exceeds the limit under concurrent creation', async () => {
      const { client, userId } = await signedIn('race-limit');

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => create(client, `Parallel ${i}`)),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma.workbook.count({ where: { userId } })).toBe(5);
      // Exactly one default, and every file matches a metadata row.
      const rows = await prisma.workbook.findMany({ where: { userId } });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(rows.map((r) => r.id)).toContain(user.defaultWorkbookId);
      for (const row of rows) {
        expect((await stat(path.join(storageRoot, row.storageKey))).size).toBe(row.sizeBytes);
      }
    });

    it('lets only one of two concurrent renames with the same version win', async () => {
      const { client } = await signedIn('race-rename');
      const workbook = (await create(client, 'Start').expect(201)).body as Workbook;

      const [a, b] = await Promise.all([
        client.patch(`/api/workbooks/${workbook.id}`, { name: 'From tab A', version: 1 }),
        client.patch(`/api/workbooks/${workbook.id}`, { name: 'From tab B', version: 1 }),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await client.get(`/api/workbooks/${workbook.id}`)).body.version).toBe(2);
    });
  });

  describe('multi-user isolation', () => {
    it('never exposes or changes another user’s workbooks', async () => {
      const alice = await signedIn('alice');
      const bob = await signedIn('bob');
      const aliceBook = (await create(alice.client, 'Alice private').expect(201)).body as Workbook;
      await create(bob.client, 'Bob book').expect(201);

      // Bob only sees his own workbooks.
      expect((await list(bob.client)).workbooks.map((w) => w.name)).toEqual(['Bob book']);

      // Every operation on Alice's workbook looks like "not found" to Bob.
      const id = aliceBook.id;
      await bob.client.get(`/api/workbooks/${id}`).expect(404);
      await download(bob.client, id).expect(404);
      await bob.client.patch(`/api/workbooks/${id}`, { name: 'Hacked', version: 1 }).expect(404);
      await bob.client.post(`/api/workbooks/${id}/default`).expect(404);
      await bob.client.agent
        .delete(`/api/workbooks/${id}`)
        .set('X-CSRF-Token', bob.client.csrfToken)
        .expect(404);

      // Alice's workbook, file and default are untouched.
      const aliceView = await list(alice.client);
      expect(aliceView.workbooks).toEqual([
        expect.objectContaining({ id, name: 'Alice private', version: 1 }),
      ]);
      expect(aliceView.defaultWorkbookId).toBe(id);
      await download(alice.client, id).expect(200);
      expect((await list(bob.client)).defaultWorkbookId).not.toBe(id);
    });

    it('stores each user’s files in a separate folder', async () => {
      const alice = await signedIn('folder-a');
      const bob = await signedIn('folder-b');
      const a = (await create(alice.client, 'Same').expect(201)).body as Workbook;
      const b = (await create(bob.client, 'Same').expect(201)).body as Workbook;

      expect((await stat(path.join(storageRoot, alice.userId, `${a.id}.xlsx`))).isFile()).toBe(
        true,
      );
      expect((await stat(path.join(storageRoot, bob.userId, `${b.id}.xlsx`))).isFile()).toBe(true);
    });

    it('requires authentication and CSRF protection', async () => {
      const anonymous = await AuthTestClient.create(app);
      await anonymous.get('/api/workbooks').expect(401);
      await anonymous.post('/api/workbooks', { name: 'X' }).expect(401);

      const { client } = await signedIn('csrf');
      await client.agent.post('/api/workbooks').send({ name: 'No CSRF' }).expect(403);
      await client.get('/api/workbooks/not-a-uuid').expect(400);
    });
  });
});
