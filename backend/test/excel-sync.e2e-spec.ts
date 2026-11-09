import type { INestApplication } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { AlertService } from '../src/common/monitoring/alert.service.js';
import { ExcelSyncWorker } from '../src/modules/workbooks/sync/excel-sync.worker.js';
import { readWorkbookRows } from '../src/modules/workbooks/workbook-reader.js';
import { WorkbookStorageService } from '../src/modules/workbooks/workbook-storage.service.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

interface SaveResult {
  task: { id: string; workbookId: string; version: number };
  update: { id: string; version: number };
  excelSync: { workbookId: string; status: string; jobId: string | null };
}

type Write = WorkbookStorageService['write'];

// What users see instead of raw errors (which can contain server paths).
const LOCKED = 'The Excel file is locked or cannot be written on the server.';
const NO_SPACE = 'There is not enough storage space on the server to write the Excel file.';

/** Editable fields of a task update (PATCH body without description and version). */
const EDIT = { reference: 'https://docs.example.com/ledger', status: 'IN_PROGRESS' };

const TASK = {
  entryDate: '2026-11-05',
  description: 'Reconciled the ledger.',
  reference: 'https://docs.example.com/ledger',
  status: 'IN_PROGRESS',
};

/** Settles after `ms` (without blocking the event loop). */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise with its resolve function exposed. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
// The background worker is disabled for e2e runs (vitest.config.e2e.ts): jobs are processed
// with drain(), and EXCEL_SYNC_MAX_ATTEMPTS=3 / EXCEL_SYNC_RETRY_BASE_MS=1000.
describe('Excel synchronisation outbox (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let worker: ExcelSyncWorker;
  let storage: WorkbookStorageService;
  let cleanup: () => Promise<void>;
  let writeSpy: MockInstance<Write> | undefined;

  async function userWithWorkbook(label: string) {
    const client = await AuthTestClient.create(app);
    const res = await client.register(uniqueEmail(label)).expect(201);
    const wb = await client.post('/api/workbooks', { name: 'Daily Tasks' }).expect(201);
    return {
      client,
      userId: (res.body as { user: { id: string } }).user.id,
      workbookId: (wb.body as { id: string }).id,
    };
  }

  async function createTask(client: AuthTestClient, name: string, body: object = {}) {
    const res = await client.post('/api/tasks', { ...TASK, name, ...body }).expect(201);
    return res.body as SaveResult;
  }

  /** Replaces storage writes for one workbook (others are written normally). */
  function interceptWrites(
    workbookId: string,
    impl: (original: Write, ...args: Parameters<Write>) => ReturnType<Write>,
  ) {
    const original = storage.write.bind(storage);
    writeSpy = vi
      .spyOn(storage, 'write')
      .mockImplementation((key, data) =>
        key.includes(workbookId) ? impl(original, key, data) : original(key, data),
      );
    return writeSpy;
  }

  const job = (id: string) => prisma.excelSyncJob.findUniqueOrThrow({ where: { id } });

  /** Simulates the passage of time until the job's retry is due. */
  const makeDue = (id: string) =>
    prisma.excelSyncJob.update({
      where: { id },
      data: { nextAttemptAt: new Date(Date.now() - 1) },
    });

  /** Rows of the stored file, and the task updates that must be in it. */
  async function fileAndDatabase(workbookId: string) {
    const workbook = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
    const rows = await readWorkbookRows(await storage.read(workbook.storageKey));
    const updates = await prisma.taskUpdate.findMany({
      where: { task: { workbookId, deletedAt: null } },
      select: { id: true, taskId: true, description: true },
    });
    return { workbook, rows, updates };
  }

  /** The file contains each live task update exactly once, with current values. */
  async function expectFileMatchesDatabase(workbookId: string) {
    const { workbook, rows, updates } = await fileAndDatabase(workbookId);
    expect(workbook.syncedVersion).toBe(workbook.dataVersion);
    const ids = rows.map((row) => row.taskUpdateId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate rows
    expect([...ids].sort()).toEqual(updates.map((u) => u.id).sort());
    for (const update of updates) {
      const row = rows.find((r) => r.taskUpdateId === update.id);
      expect(row).toMatchObject({ taskId: update.taskId, description: update.description });
    }
    return rows;
  }

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
    worker = app.get(ExcelSyncWorker);
    storage = app.get(WorkbookStorageService);
  });

  afterEach(async () => {
    writeSpy?.mockRestore();
    writeSpy = undefined;
    await worker.stop();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('transactional outbox', () => {
    it('saves the task and queues exactly one job in the same transaction; a rejected change queues none', async () => {
      const { client, workbookId } = await userWithWorkbook('outbox');

      const saved = await createTask(client, 'Ledger');
      await client.post('/api/tasks', { ...TASK, name: ' LEDGER ' }).expect(409);
      await client
        .post(`/api/tasks/${saved.task.id}/updates`, { ...TASK, entryDate: '2026-11-05' })
        .expect(409);

      expect(saved.excelSync).toEqual({ workbookId, status: 'queued', jobId: expect.any(String) });
      const jobs = await prisma.excelSyncJob.findMany({ where: { workbookId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        id: saved.excelSync.jobId,
        reason: 'TASK_CREATED',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
      });

      // A no-op edit changes nothing, so it queues nothing.
      const noop = await client
        .patch(`/api/tasks/${saved.task.id}/updates/${saved.update.id}`, {
          description: TASK.description,
          reference: TASK.reference,
          status: TASK.status,
          version: saved.update.version,
        })
        .expect(200);
      expect(noop.body.excelSync).toEqual({ workbookId, status: 'unchanged', jobId: null });
      expect(await prisma.excelSyncJob.count({ where: { workbookId } })).toBe(1);

      await worker.drain();
      expect(await job(saved.excelSync.jobId!)).toMatchObject({
        status: 'SUCCEEDED',
        attempts: 1,
        lockedBy: null,
        completedAt: expect.any(Date),
      });
      await expectFileMatchesDatabase(workbookId);
    });

    it('queues a job for every kind of change (add entry, edit, rename, delete)', async () => {
      const { client, workbookId } = await userWithWorkbook('reasons');
      const created = await createTask(client, 'Payroll');
      const added = (
        await client
          .post(`/api/tasks/${created.task.id}/updates`, { ...TASK, entryDate: '2026-11-06' })
          .expect(201)
      ).body as SaveResult;
      await client
        .patch(`/api/tasks/${created.task.id}/updates/${added.update.id}`, {
          ...EDIT,
          description: 'Edited',
          version: added.update.version,
        })
        .expect(200);
      const renamed = await client
        .patch(`/api/tasks/${created.task.id}`, { name: 'Payroll run', version: 3 })
        .expect(200);
      await client.agent
        .delete(`/api/tasks/${created.task.id}?version=${renamed.body.task.version as number}`)
        .set('X-CSRF-Token', client.csrfToken)
        .expect(200);

      const jobs = await prisma.excelSyncJob.findMany({
        where: { workbookId },
        orderBy: { targetDataVersion: 'asc' },
      });
      expect(jobs.map((j) => [j.reason, j.targetDataVersion, j.taskId])).toEqual([
        ['TASK_CREATED', 1, created.task.id],
        ['ENTRY_ADDED', 2, created.task.id],
        ['ENTRY_UPDATED', 3, created.task.id],
        ['TASK_RENAMED', 4, created.task.id],
        ['TASK_DELETED', 5, created.task.id],
      ]);

      // One rebuild covers every queued change (coalescing), and the deleted task is gone.
      const writes = interceptWrites(workbookId, (original, key, data) => original(key, data));
      await worker.drain();
      expect(writes).toHaveBeenCalledTimes(1);
      const done = await prisma.excelSyncJob.findMany({ where: { workbookId } });
      expect(done.every((j) => j.status === 'SUCCEEDED')).toBe(true);
      expect(done.filter((j) => j.resolvedByJobId === null)).toHaveLength(1);
      expect(await expectFileMatchesDatabase(workbookId)).toEqual([]);
    });
  });

  describe('non-blocking API', () => {
    it('answers task requests while a workbook file is being written, and the later change is synced too', async () => {
      const { client, workbookId } = await userWithWorkbook('nonblocking');
      const first = await createTask(client, 'First');
      const writing = gate();
      const release = gate();
      interceptWrites(workbookId, async (original, key, data) => {
        writing.open();
        await release.promise; // a slow disk: the worker holds the workbook lock meanwhile
        return original(key, data);
      });

      const draining = worker.drain();
      await writing.promise;

      const startedAt = Date.now();
      const second = await createTask(client, 'Second');
      await client
        .patch(`/api/tasks/${first.task.id}/updates/${first.update.id}`, {
          ...EDIT,
          description: 'Edited during the write',
          version: 1,
        })
        .expect(200);
      expect(Date.now() - startedAt).toBeLessThan(3000);
      expect(second.excelSync.status).toBe('queued');
      expect(await job(second.excelSync.jobId!)).toMatchObject({ status: 'PENDING' });

      release.open();
      await draining;
      await worker.drain(); // jobs queued during the write (if not already picked up)

      const rows = await expectFileMatchesDatabase(workbookId);
      expect(rows.map((r) => r.taskName).sort()).toEqual(['First', 'Second']);
      expect(rows.find((r) => r.taskName === 'First')?.description).toBe('Edited during the write');
    });
  });

  describe('failures, retries and alerts', () => {
    it('keeps the saved task when Excel fails, retries with backoff and recovers', async () => {
      const { client, workbookId } = await userWithWorkbook('retry');
      let failures = 1;
      interceptWrites(workbookId, (original, key, data) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('EBUSY: resource busy or locked'));
        }
        return original(key, data);
      });

      const saved = await createTask(client, 'Survives Excel');
      await worker.drain();

      // The task is committed regardless of the Excel failure.
      expect(await prisma.task.findUnique({ where: { id: saved.task.id } })).not.toBeNull();
      const failed = await job(saved.excelSync.jobId!);
      expect(failed).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        lastError: 'EBUSY: resource busy or locked',
        lockedBy: null,
      });
      const delay = failed.nextAttemptAt.getTime() - failed.updatedAt.getTime();
      expect(delay).toBeGreaterThanOrEqual(700);
      expect(delay).toBeLessThanOrEqual(1300);

      const status = (await client.get(`/api/workbooks/${workbookId}/sync-status`).expect(200))
        .body as Record<string, unknown>;
      expect(status).toMatchObject({
        state: 'retrying',
        retryingJobs: 1,
        lastError: LOCKED,
        nextRetryAt: failed.nextAttemptAt.toISOString(),
      });
      expect((await client.get(`/api/workbooks/${workbookId}`)).body).toMatchObject({
        syncStatus: 'retrying',
        syncError: LOCKED,
      });

      // Not retried before it is due.
      await worker.drain();
      expect(await job(saved.excelSync.jobId!)).toMatchObject({ status: 'FAILED', attempts: 1 });

      await makeDue(saved.excelSync.jobId!);
      await worker.drain();
      expect(await job(saved.excelSync.jobId!)).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
      await expectFileMatchesDatabase(workbookId);
      expect((await client.get(`/api/workbooks/${workbookId}`)).body).toMatchObject({
        syncStatus: 'synced',
        syncError: null,
      });
    });

    it('stops after the retry limit, raises an alert, and a manual resync recovers', async () => {
      const { client, workbookId } = await userWithWorkbook('dead');
      const alert = vi.spyOn(app.get(AlertService), 'raise').mockResolvedValue(undefined);
      interceptWrites(workbookId, () =>
        Promise.reject(new Error('ENOSPC: no space left on device')),
      );

      const saved = await createTask(client, 'Disk full');
      const jobId = saved.excelSync.jobId!;
      const delays: number[] = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await worker.drain();
        const current = await job(jobId);
        expect(current.attempts).toBe(attempt);
        if (attempt < 3) {
          expect(current.status).toBe('FAILED');
          delays.push(current.nextAttemptAt.getTime() - current.updatedAt.getTime());
          await makeDue(jobId);
        }
      }

      // Exponential backoff: ~1 s then ~2 s (±20 % jitter).
      expect(delays[0]).toBeGreaterThanOrEqual(700);
      expect(delays[0]).toBeLessThanOrEqual(1300);
      expect(delays[1]).toBeGreaterThanOrEqual(1500);
      expect(delays[1]).toBeLessThanOrEqual(2500);

      expect(await job(jobId)).toMatchObject({
        status: 'DEAD',
        attempts: 3,
        completedAt: expect.any(Date),
      });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'excel_sync_failed',
          severity: 'critical',
          context: expect.objectContaining({
            jobId,
            workbookId,
            error: 'ENOSPC: no space left on device',
          }),
        }),
      );
      // A dead job is never picked up again on its own.
      await worker.drain();
      expect(await job(jobId)).toMatchObject({ status: 'DEAD', attempts: 3 });
      expect((await client.get(`/api/workbooks/${workbookId}/sync-status`)).body).toMatchObject({
        state: 'failed',
        failedJobs: 1,
        lastError: NO_SPACE,
      });
      expect(await prisma.task.count({ where: { workbookId } })).toBe(1);

      // The disk is fixed; the user asks for a resync.
      writeSpy?.mockRestore();
      writeSpy = undefined;
      const resync = await client.post(`/api/workbooks/${workbookId}/sync`).expect(202);
      expect(resync.body).toMatchObject({ workbookId, state: 'failed', pendingJobs: 1 });
      await worker.drain();

      const manual = await prisma.excelSyncJob.findFirstOrThrow({
        where: { workbookId, reason: 'MANUAL' },
      });
      expect(manual).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
      expect(await job(jobId)).toMatchObject({ status: 'SUCCEEDED', resolvedByJobId: manual.id });
      expect((await client.get(`/api/workbooks/${workbookId}/sync-status`)).body).toMatchObject({
        state: 'synced',
        failedJobs: 0,
        lastError: null,
      });
      await expectFileMatchesDatabase(workbookId);
      alert.mockRestore();
    });

    it('only lets the owner resynchronise a workbook or read its status', async () => {
      const alice = await userWithWorkbook('resync-alice');
      const bob = await userWithWorkbook('resync-bob');

      await bob.client.post(`/api/workbooks/${alice.workbookId}/sync`).expect(404);
      await bob.client.get(`/api/workbooks/${alice.workbookId}/sync-status`).expect(404);
      expect(await prisma.excelSyncJob.count({ where: { workbookId: alice.workbookId } })).toBe(0);
    });
  });

  describe('process failures and recovery', () => {
    it('reclaims a job whose worker died mid-sync, but not one with a live lease', async () => {
      const crashed = await userWithWorkbook('lease-crashed');
      const busy = await userWithWorkbook('lease-busy');
      const orphan = await createTask(crashed.client, 'Orphaned job');
      const leased = await createTask(busy.client, 'Leased job');
      await prisma.excelSyncJob.update({
        where: { id: orphan.excelSync.jobId! },
        data: {
          status: 'PROCESSING',
          attempts: 1,
          lockedBy: 'crashed-host:1234:deadbeef',
          lockedAt: new Date(Date.now() - 10 * 60_000), // lease (2 min) expired
        },
      });
      await prisma.excelSyncJob.update({
        where: { id: leased.excelSync.jobId! },
        data: {
          status: 'PROCESSING',
          attempts: 1,
          lockedBy: 'other-host:1:cafebabe',
          lockedAt: new Date(),
        },
      });

      await worker.drain();

      expect(await job(orphan.excelSync.jobId!)).toMatchObject({
        status: 'SUCCEEDED',
        attempts: 2,
      });
      await expectFileMatchesDatabase(crashed.workbookId);
      expect(await job(leased.excelSync.jobId!)).toMatchObject({
        status: 'PROCESSING',
        lockedBy: 'other-host:1:cafebabe',
      });
    });

    it('a failed write leaves the previous file and metadata in place, and is retried', async () => {
      const { client, workbookId } = await userWithWorkbook('atomic');
      await createTask(client, 'Before the crash');
      await worker.drain();
      const before = await storage.read(
        (await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } })).storageKey,
      );

      interceptWrites(workbookId, () => Promise.reject(new Error('process killed during write')));
      const next = await createTask(client, 'After the crash');
      await worker.drain();

      const workbook = await prisma.workbook.findUniqueOrThrow({ where: { id: workbookId } });
      expect((await storage.read(workbook.storageKey)).equals(before)).toBe(true);
      expect(workbook.syncedVersion).toBeLessThan(workbook.dataVersion);

      writeSpy?.mockRestore();
      writeSpy = undefined;
      await makeDue(next.excelSync.jobId!);
      await worker.drain();
      const rows = await expectFileMatchesDatabase(workbookId);
      expect(rows.map((r) => r.taskName)).toEqual(['Before the crash', 'After the crash']);
    });

    it('queues recovery for workbooks left behind without a job', async () => {
      const { client, workbookId } = await userWithWorkbook('orphan');
      await createTask(client, 'Lost job');
      // A job lost before the outbox existed (or deleted by hand).
      await prisma.excelSyncJob.deleteMany({ where: { workbookId } });

      expect(await worker.recoverOrphans()).toBeGreaterThanOrEqual(1);
      expect(await worker.recoverOrphans()).toBe(0); // idempotent: the job now exists
      await worker.drain();

      expect(
        await prisma.excelSyncJob.findFirstOrThrow({ where: { workbookId, reason: 'RECOVERY' } }),
      ).toMatchObject({ status: 'SUCCEEDED' });
      await expectFileMatchesDatabase(workbookId);
    });
  });

  describe('duplicate prevention', () => {
    it('never duplicates rows, however often and concurrently a workbook is synced', async () => {
      const { client, workbookId } = await userWithWorkbook('dupes');
      const task = await createTask(client, 'Daily standup');
      for (const entryDate of ['2026-11-06', '2026-11-07', '2026-11-08']) {
        await client.post(`/api/tasks/${task.task.id}/updates`, { ...TASK, entryDate }).expect(201);
      }
      await createTask(client, 'Code review');

      await worker.drain();
      // Repeated manual resyncs, processed by several concurrent drains.
      await Promise.all(
        Array.from({ length: 4 }, () =>
          client.post(`/api/workbooks/${workbookId}/sync`).expect(202),
        ),
      );
      await Promise.all([worker.drain(), worker.drain(), worker.drain()]);
      await worker.drain();

      const rows = await expectFileMatchesDatabase(workbookId);
      expect(rows).toHaveLength(5);
      expect(rows.filter((r) => r.taskId === task.task.id)).toHaveLength(4);
      expect(
        new Set(rows.filter((r) => r.taskId === task.task.id).map((r) => r.taskNumber)),
      ).toEqual(new Set([1]));
    });
  });

  describe('concurrency', () => {
    it('handles simultaneous updates from several users with one writer per workbook at a time', async () => {
      const users = await Promise.all(['a', 'b', 'c'].map((s) => userWithWorkbook(`multi-${s}`)));
      const workbookIds: string[] = [];
      for (const user of users) {
        const second = await user.client.post('/api/workbooks', { name: 'Second' }).expect(201);
        workbookIds.push(user.workbookId, (second.body as { id: string }).id);
      }

      // Track overlapping writes per file.
      const active = new Map<string, number>();
      let overlap = false;
      const original = storage.write.bind(storage);
      writeSpy = vi.spyOn(storage, 'write').mockImplementation(async (key, data) => {
        const now = (active.get(key) ?? 0) + 1;
        active.set(key, now);
        overlap ||= now > 1;
        try {
          await pause(15);
          return await original(key, data);
        } finally {
          active.set(key, (active.get(key) ?? 1) - 1);
        }
      });

      // Every user submits tasks to both workbooks at once while three workers drain.
      const submissions = users.flatMap((user, u) =>
        Array.from({ length: 6 }, (_, i) =>
          user.client
            .post('/api/tasks', {
              ...TASK,
              name: `Task ${i % 3}`,
              workbookId: workbookIds[u * 2 + (i % 2)],
            })
            .then((res) => res.status),
        ),
      );
      const draining = Promise.all([worker.drain(), worker.drain(), worker.drain()]);
      const statuses = await Promise.all(submissions);
      await draining;
      // Concurrent edits of the same entries too.
      const edits = await Promise.all(
        users.map(async (user) => {
          const tasks = await prisma.task.findMany({
            where: { userId: user.userId },
            include: { updates: true },
          });
          return Promise.all(
            tasks.map((t) =>
              user.client
                .patch(`/api/tasks/${t.id}/updates/${t.updates[0]!.id}`, {
                  ...EDIT,
                  description: `Edited ${t.name}`,
                  version: t.updates[0]!.version,
                })
                .then((res) => res.status),
            ),
          );
        }),
      );
      await Promise.all([worker.drain(), worker.drain(), worker.drain()]);
      await worker.drain();

      expect(statuses.every((s) => s === 201)).toBe(true);
      expect(edits.flat().every((s) => s === 200)).toBe(true);
      expect(overlap).toBe(false);
      for (const id of workbookIds) {
        const rows = await expectFileMatchesDatabase(id);
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.description.startsWith('Edited '))).toBe(true);
      }
      const open = await prisma.excelSyncJob.count({
        where: { workbookId: { in: workbookIds }, status: { not: 'SUCCEEDED' } },
      });
      expect(open).toBe(0);
    });
  });

  describe('background worker', () => {
    it('processes queued jobs automatically once started', async () => {
      const { client, workbookId } = await userWithWorkbook('background');
      worker.start();

      await createTask(client, 'Picked up automatically');
      let state = '';
      for (let i = 0; i < 50 && state !== 'synced'; i += 1) {
        await pause(100);
        state = (await client.get(`/api/workbooks/${workbookId}/sync-status`)).body.state as string;
      }

      expect(state).toBe('synced');
      await worker.stop();
      await expectFileMatchesDatabase(workbookId);
    });
  });
});
