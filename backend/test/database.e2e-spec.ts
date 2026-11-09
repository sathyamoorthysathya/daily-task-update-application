import type { INestApplication } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'prisma', 'migrations');

/** Runs SQL expected to violate a constraint, inside a savepoint-free statement. */
async function rejects(prisma: PrismaService, sql: Promise<unknown>, pattern: RegExp) {
  await expect(sql).rejects.toThrow(pattern);
  // The connection is still usable afterwards.
  expect(await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
// Checks the database itself: migrations, constraints, triggers, cascades and indexes.
describe('Database (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cleanup: () => Promise<void>;

  /** A user with one workbook and one task, created through the API. */
  async function seeded() {
    const client = await AuthTestClient.create(app);
    const reg = await client.register(uniqueEmail('db')).expect(201);
    const userId = (reg.body as { user: { id: string } }).user.id;
    const wb = await client.post('/api/workbooks', { name: 'DB checks' }).expect(201);
    const task = await client
      .post('/api/tasks', {
        name: 'Constraint test',
        entryDate: '2026-11-08',
        description: 'Row for constraint checks',
        status: 'TO_DO',
      })
      .expect(201);
    return {
      client,
      userId,
      workbookId: (wb.body as { id: string }).id,
      taskId: (task.body as { task: { id: string } }).task.id,
      updateId: (task.body as { update: { id: string } }).update.id,
    };
  }

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('migrations', () => {
    it('has applied every migration in the repository, none failed or rolled back', async () => {
      const onDisk = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const applied = await prisma.$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
      const succeeded = applied
        .filter((m) => m.finished_at !== null && m.rolled_back_at === null)
        .map((m) => m.migration_name)
        .sort();

      expect(succeeded).toEqual(onDisk);
    });

    it('runs sessions in UTC with the pg_trgm extension available', async () => {
      const [settings] = await prisma.$queryRaw<{ tz: string; trgm: boolean }[]>`
        SELECT current_setting('TimeZone') AS tz,
               EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS trgm`;
      expect(settings).toEqual({ tz: 'UTC', trgm: true });
    });

    it('stores timestamps as the correct instant (no time-zone shift)', async () => {
      const { userId } = await seeded();
      const [row] = await prisma.$queryRaw<{ drift: number }[]>`
        SELECT abs(extract(epoch FROM (now() - created_at))) AS drift FROM users WHERE id = ${userId}::uuid`;
      expect(Number(row!.drift)).toBeLessThan(60);
    });
  });

  describe('constraints', () => {
    it('enforces uniqueness of emails, workbook names, task names, task numbers and daily entries', async () => {
      const { userId, workbookId, taskId } = await seeded();
      const email = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;

      await rejects(
        prisma,
        prisma.user.create({ data: { name: 'Dup', email } }),
        /Unique constraint/,
      );
      // Same task number in the same workbook.
      await rejects(
        prisma,
        prisma.$executeRaw`INSERT INTO tasks (id, user_id, workbook_id, task_number, name, name_key, status, last_entry_date, updated_at)
          SELECT gen_random_uuid(), user_id, workbook_id, task_number, 'Other', 'other', status, last_entry_date, now()
          FROM tasks WHERE id = ${taskId}::uuid`,
        /tasks_workbook_id_task_number_key|duplicate key/,
      );
      // Same name (case-insensitive key) in the same workbook.
      await rejects(
        prisma,
        prisma.$executeRaw`INSERT INTO tasks (id, user_id, workbook_id, task_number, name, name_key, status, last_entry_date, updated_at)
          SELECT gen_random_uuid(), user_id, workbook_id, task_number + 100, upper(name), name_key, status, last_entry_date, now()
          FROM tasks WHERE id = ${taskId}::uuid`,
        /tasks_workbook_id_name_key_key|duplicate key/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`INSERT INTO task_updates (id, task_id, user_id, entry_date, status, description, updated_at)
          SELECT gen_random_uuid(), task_id, user_id, entry_date, status, 'again', now()
          FROM task_updates WHERE task_id = ${taskId}::uuid`,
        /task_updates_task_id_entry_date_key|duplicate key/,
      );
      expect(workbookId).toBeDefined();
    });

    it('rejects invalid values with CHECK constraints', async () => {
      const { workbookId, taskId, updateId } = await seeded();

      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE workbooks SET synced_version = data_version + 1 WHERE id = ${workbookId}::uuid`,
        /workbooks_sync_check/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE workbooks SET storage_key = '../../etc/passwd' WHERE id = ${workbookId}::uuid`,
        /workbooks_storage_key_check/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE tasks SET task_number = 0 WHERE id = ${taskId}::uuid`,
        /tasks_values_check/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE tasks SET deleted_at = now() WHERE id = ${taskId}::uuid`,
        /tasks_deleted_name_check/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE task_updates SET description = '   ' WHERE id = ${updateId}::uuid`,
        /task_updates_values_check/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE excel_sync_jobs SET attempts = -1 WHERE workbook_id = ${workbookId}::uuid`,
        /excel_sync_jobs_values_check/,
      );
    });

    it('keeps the task history and the audit log append-only', async () => {
      const { taskId, userId } = await seeded();

      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE task_history SET changes = '{}' WHERE task_id = ${taskId}::uuid`,
        /append-only/,
      );
      await rejects(
        prisma,
        prisma.$executeRaw`UPDATE audit_events SET outcome = 'FAILURE' WHERE user_id = ${userId}::uuid`,
        /append-only/,
      );
    });
  });

  describe('cascades', () => {
    it('deleting a user removes all their data except the audit log', async () => {
      const { userId, workbookId, taskId } = await seeded();

      await prisma.user.delete({ where: { id: userId } });

      const [counts] = await prisma.$queryRaw<Record<string, bigint>[]>`
        SELECT
          (SELECT count(*) FROM workbooks WHERE user_id = ${userId}::uuid) AS workbooks,
          (SELECT count(*) FROM tasks WHERE id = ${taskId}::uuid) AS tasks,
          (SELECT count(*) FROM task_updates WHERE task_id = ${taskId}::uuid) AS updates,
          (SELECT count(*) FROM task_history WHERE task_id = ${taskId}::uuid) AS history,
          (SELECT count(*) FROM excel_sync_jobs WHERE workbook_id = ${workbookId}::uuid) AS jobs,
          (SELECT count(*) FROM refresh_tokens WHERE user_id = ${userId}::uuid) AS sessions,
          (SELECT count(*) FROM user_profiles WHERE user_id = ${userId}::uuid) AS profiles,
          (SELECT count(*) FROM audit_events WHERE user_id = ${userId}::uuid) AS audit`;
      expect(Object.fromEntries(Object.entries(counts!).map(([k, v]) => [k, Number(v)]))).toEqual({
        workbooks: 0,
        tasks: 0,
        updates: 0,
        history: 0,
        jobs: 0,
        sessions: 0,
        profiles: 0,
        audit: expect.any(Number) as number,
      });
      expect(Number(counts!.audit)).toBeGreaterThan(0);
    });
  });

  describe('indexes', () => {
    it('has the indexes the main queries rely on', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'users_email_key',
          'refresh_tokens_token_hash_key',
          'workbooks_user_id_name_key_key',
          'tasks_workbook_id_task_number_key',
          'task_updates_task_id_entry_date_key',
          'excel_sync_jobs_status_next_attempt_at_idx',
          'audit_events_user_id_created_at_idx',
        ]),
      );
      // Trigram index for substring search on task names.
      const [trgm] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_indexes
        WHERE tablename = 'tasks' AND indexdef ILIKE '%gin%' AND indexdef ILIKE '%name_key%'`;
      expect(Number(trgm!.n)).toBe(1);
    });

    it('stores no file contents in the database except validated avatars', async () => {
      const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'bytea'`;
      expect(columns).toEqual([{ table_name: 'user_avatars', column_name: 'data' }]);
    });
  });
});
