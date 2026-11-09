import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AuthTestClient, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

interface Summary {
  today: string;
  totals: {
    tasks: number;
    entries: number;
    workbooks: number;
    completed: number;
    open: number;
    completionRate: number;
  };
  byStatus: Record<string, number>;
  activity: { date: string; entries: number; completed: number }[];
  periods: { today: number; last7Days: number; previous7Days: number };
  workbooks: { id: string; name: string; tasks: number; completed: number }[];
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Dashboard summary (e2e)', () => {
  let app: INestApplication<App>;
  let cleanup: () => Promise<void>;

  async function signedIn(label: string) {
    const client = await AuthTestClient.create(app);
    await client.register(uniqueEmail(label)).expect(201);
    return client;
  }

  async function task(client: AuthTestClient, body: Record<string, unknown>) {
    const res = await client
      .post('/api/tasks', { description: 'Work', status: 'IN_PROGRESS', ...body })
      .expect(201);
    return res.body as { task: { id: string; version: number } };
  }

  const summary = async (client: AuthTestClient, query = '?today=2026-11-08') =>
    (await client.get(`/api/tasks/summary${query}`).expect(200)).body as Summary;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('is empty for a new user, with a zero-filled activity window', async () => {
    const client = await signedIn('summary-empty');

    const result = await summary(client);

    expect(result.totals).toEqual({
      tasks: 0,
      entries: 0,
      workbooks: 0,
      completed: 0,
      open: 0,
      completionRate: 0,
    });
    expect(result.activity).toHaveLength(14);
    expect(result.activity[0]).toEqual({ date: '2026-10-26', entries: 0, completed: 0 });
    expect(result.activity.at(-1)).toEqual({ date: '2026-11-08', entries: 0, completed: 0 });
    expect(result.workbooks).toEqual([]);
  });

  it('counts tasks by status, daily entries, weekly totals and workbook progress', async () => {
    const client = await signedIn('summary');
    const main = (await client.post('/api/workbooks', { name: 'Main' }).expect(201)).body as {
      id: string;
    };
    const side = (await client.post('/api/workbooks', { name: 'Side' }).expect(201)).body as {
      id: string;
    };

    const report = await task(client, { name: 'Report', entryDate: '2026-11-08' });
    await client
      .post(`/api/tasks/${report.task.id}/updates`, {
        entryDate: '2026-11-07',
        description: 'Day before',
        status: 'COMPLETED',
      })
      .expect(201);
    await task(client, { name: 'Review', entryDate: '2026-11-08', status: 'COMPLETED' });
    await task(client, { name: 'Old work', entryDate: '2026-10-30', status: 'PENDING' });
    await task(client, {
      name: 'Side task',
      entryDate: '2026-11-03',
      status: 'COMPLETED',
      workbookId: side.id,
    });
    // Deleted tasks are not counted.
    const gone = await task(client, { name: 'Deleted', entryDate: '2026-11-08' });
    await client.agent
      .delete(`/api/tasks/${gone.task.id}?version=${gone.task.version}`)
      .set('X-CSRF-Token', client.csrfToken)
      .expect(200);

    const result = await summary(client);

    expect(result.totals).toEqual({
      tasks: 4,
      entries: 5,
      workbooks: 2,
      completed: 2,
      open: 2,
      completionRate: 50,
    });
    // "Report" keeps the status of its latest entry (in progress, 8 Nov).
    expect(result.byStatus).toEqual({
      TO_DO: 0,
      IN_PROGRESS: 1,
      PENDING: 1,
      COMPLETED: 2,
      ON_HOLD: 0,
    });
    const day = (date: string) => result.activity.find((d) => d.date === date);
    expect(day('2026-11-08')).toEqual({ date: '2026-11-08', entries: 2, completed: 1 });
    expect(day('2026-11-07')).toEqual({ date: '2026-11-07', entries: 1, completed: 1 });
    expect(day('2026-11-05')).toEqual({ date: '2026-11-05', entries: 0, completed: 0 });
    // 2 Nov - 8 Nov: 4 entries; 26 Oct - 1 Nov: 1 entry.
    expect(result.periods).toEqual({ today: 2, last7Days: 4, previous7Days: 1 });
    expect(result.workbooks).toEqual([
      expect.objectContaining({ id: main.id, name: 'Main', tasks: 3, completed: 1 }),
      expect.objectContaining({ id: side.id, name: 'Side', tasks: 1, completed: 1 }),
    ]);
  });

  it('supports other window lengths and defaults to the server date', async () => {
    const client = await signedIn('summary-window');

    expect((await summary(client, '?today=2026-11-08&days=30')).activity).toHaveLength(30);
    const defaulted = await summary(client, '');
    expect(defaulted.activity).toHaveLength(14);
    expect(defaulted.today).toBe(new Date().toISOString().slice(0, 10));
  });

  it('only counts the signed-in user’s data', async () => {
    const alice = await signedIn('summary-alice');
    await alice.post('/api/workbooks', { name: 'Alice' }).expect(201);
    await task(alice, { name: 'Private', entryDate: '2026-11-08' });
    const bob = await signedIn('summary-bob');

    const result = await summary(bob);

    expect(result.totals.tasks).toBe(0);
    expect(result.periods.today).toBe(0);
    expect(result.workbooks).toEqual([]);
  });

  it('validates the query and requires a session', async () => {
    const client = await signedIn('summary-invalid');
    await client.get('/api/tasks/summary?today=2026-02-30').expect(400);
    await client.get('/api/tasks/summary?days=3').expect(400);
    await client.get('/api/tasks/summary?days=365').expect(400);

    const anonymous = await AuthTestClient.create(app);
    await anonymous.get('/api/tasks/summary').expect(401);
  });
});
