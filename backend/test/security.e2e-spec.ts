import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { TasksService } from '../src/modules/tasks/tasks.service.js';
import { AuthTestClient, STRONG_PASSWORD, uniqueEmail } from './support/auth-test-client.js';
import { createTestApp } from './support/test-app.js';

const TASK = {
  name: 'Security review',
  entryDate: '2026-11-08',
  description: 'Checked headers.',
  status: 'IN_PROGRESS',
};

/** Waits for an asynchronously written audit row. */
async function eventually<T>(read: () => Promise<T | null>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
// The e2e config trusts the loopback proxy (TRUST_PROXY=true): X-Forwarded-For simulates clients.
describe('Production security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cleanup: () => Promise<void>;

  async function signedIn(label: string) {
    const client = await AuthTestClient.create(app);
    const email = uniqueEmail(label);
    const res = await client.register(email).expect(201);
    return { client, email, userId: (res.body as { user: { id: string } }).user.id };
  }

  const audit = (where: object) =>
    prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('HTTP hardening', () => {
    it('sends secure headers and a deny-all CSP on API responses', async () => {
      const res = await request(app.getHttpServer()).get('/api/health/live').expect(200);

      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('tags every response with a request ID, also returned in error bodies', async () => {
      const generated = await request(app.getHttpServer()).get('/api/nope').expect(404);
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(generated.body.requestId).toBe(generated.headers['x-request-id']);

      const kept = await request(app.getHttpServer())
        .get('/api/health/live')
        .set('X-Request-Id', 'lb-req-0123456789');
      expect(kept.headers['x-request-id']).toBe('lb-req-0123456789');

      const replaced = await request(app.getHttpServer())
        .get('/api/health/live')
        .set('X-Request-Id', '<script>alert(1)</script>');
      expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('allows credentialed CORS only for configured origins', async () => {
      const allowed = await request(app.getHttpServer())
        .options('/api/auth/me')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');

      const denied = await request(app.getHttpServer())
        .options('/api/auth/me')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects oversized JSON bodies', async () => {
      const client = await AuthTestClient.create(app);
      const res = await client.post('/api/auth/login', {
        email: 'big@e2e.test',
        password: 'x'.repeat(200_000),
      });
      expect(res.status).toBe(413);
    });

    it('rejects path traversal and injection attempts at the validation layer', async () => {
      const { client } = await signedIn('inject');
      await client.get('/api/workbooks/..%2F..%2Fetc%2Fpasswd').expect(400);
      await client.get('/api/tasks/1%20OR%201=1').expect(400);
      const search = await client.get(`/api/tasks?search=${encodeURIComponent("' OR '1'='1")}`);
      expect(search.status).toBe(200);
      expect(search.body.total).toBe(0);
    });

    it('rejects references with control characters (javascript: obfuscation)', async () => {
      const { client } = await signedIn('reference');
      await client.post('/api/workbooks', { name: 'Main' }).expect(201);
      for (const reference of [
        'java\tscript:alert(1)',
        '\u0001javascript:alert(1)',
        'javascript:x',
      ]) {
        const res = await client.post('/api/tasks', { ...TASK, reference }).expect(400);
        expect(res.body.errors[0].field).toBe('reference');
      }
    });

    it('accepts only a single file part on avatar upload', async () => {
      const { client } = await signedIn('multipart');
      const res = await client.agent
        .put('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .field('extra', 'x'.repeat(1000))
        .attach('avatar', Buffer.from('not an image'), 'a.png');
      expect([400, 404, 413]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });

  describe('rate limiting behind a proxy', () => {
    it('uses the forwarded client IP, so one client cannot lock out others', async () => {
      const email = uniqueEmail('per-ip');
      const victim = await AuthTestClient.create(app);
      await victim.register(email).expect(201);
      const attacker = await AuthTestClient.create(app);

      for (let i = 0; i < 5; i += 1) {
        await attacker.agent
          .post('/api/auth/login')
          .set('X-CSRF-Token', attacker.csrfToken)
          .set('X-Forwarded-For', '203.0.113.7')
          .send({ email, password: 'Wrong-pass-1' })
          .expect(401);
      }
      await attacker.agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', attacker.csrfToken)
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ email, password: 'Wrong-pass-1' })
        .expect(429);

      // The real owner, from another address, still signs in.
      await victim.agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', victim.csrfToken)
        .set('X-Forwarded-For', '198.51.100.20')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      const failures = await audit({ event: 'auth.login', outcome: 'FAILURE', email: null });
      expect(failures.some((e) => e.ip === '203.0.113.7')).toBe(true);
    });

    it('limits attempts per account across rotating IP addresses', async () => {
      const email = uniqueEmail('rotating');
      const owner = await AuthTestClient.create(app);
      await owner.register(email).expect(201);
      const attacker = await AuthTestClient.create(app);

      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await attacker.agent
          .post('/api/auth/login')
          .set('X-CSRF-Token', attacker.csrfToken)
          .set('X-Forwarded-For', `192.0.2.${i + 1}`)
          .send({ email, password: 'Wrong-pass-1' });
        statuses.push(res.status);
      }
      // LOGIN_ACCOUNT_RATE_LIMIT=10 in the e2e config.
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('limits task changes per session', async () => {
      const { client } = await signedIn('writes');
      const other = await signedIn('writes-other');
      const statuses: number[] = [];
      // Invalid bodies: the throttle runs before validation, so nothing is created.
      for (let i = 0; i < 61; i += 1) {
        statuses.push((await client.post('/api/tasks', {})).status);
      }
      expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true);
      expect(statuses[60]).toBe(429);
      // Other users are not affected.
      expect((await other.client.post('/api/tasks', {})).status).toBe(400);
    });
  });

  describe('sessions', () => {
    it('ends a session after SESSION_MAX_DAYS even if it keeps being refreshed', async () => {
      const { client, userId } = await signedIn('max-age');
      await prisma.refreshToken.updateMany({
        where: { userId },
        data: { sessionStartedAt: new Date(Date.now() - 31 * 86_400_000) },
      });

      const res = await client.post('/api/auth/refresh').expect(401);

      expect(res.body.code).toBe('REFRESH_TOKEN_EXPIRED');
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
      expect(await audit({ userId, event: 'auth.session_expired' })).toHaveLength(1);
    });

    it('never issues a refresh token that outlives the session limit', async () => {
      const { client, userId } = await signedIn('cap');
      const started = new Date(Date.now() - 29.5 * 86_400_000);
      await prisma.refreshToken.updateMany({
        where: { userId },
        data: { sessionStartedAt: started },
      });

      await client.post('/api/auth/refresh').expect(204);

      const current = await prisma.refreshToken.findFirstOrThrow({
        where: { userId, revokedAt: null },
      });
      expect(current.expiresAt.getTime()).toBeLessThanOrEqual(started.getTime() + 30 * 86_400_000);
      expect(current.sessionStartedAt.getTime()).toBe(started.getTime());
    });
  });

  describe('audit log', () => {
    it('records the security events of an account, with IP, user agent and request ID', async () => {
      const email = uniqueEmail('audited');
      const client = await AuthTestClient.create(app);
      const registered = await client.agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', client.csrfToken)
        .set('X-Forwarded-For', '198.51.100.7')
        .set('User-Agent', 'AuditTest/1.0')
        .send({ name: 'Audited', email, password: STRONG_PASSWORD })
        .expect(201);
      const userId = (registered.body as { user: { id: string } }).user.id;

      await client.login(email, 'Wrong-pass-1').expect(401);
      await client.login(email).expect(200);
      await client
        .post('/api/auth/change-password', {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'An0ther-strong-pass',
        })
        .expect(204);
      const wb = await client.post('/api/workbooks', { name: 'Audited' }).expect(201);
      await client.post('/api/tasks', TASK).expect(201);
      await client.agent
        .delete(`/api/workbooks/${wb.body.id as string}`)
        .set('X-CSRF-Token', client.csrfToken)
        .expect(204);
      await client.post('/api/auth/logout-all').expect(204);

      const events = await audit({ userId });
      expect(events.map((e) => [e.event, e.outcome])).toEqual([
        ['auth.register', 'SUCCESS'],
        ['auth.login', 'FAILURE'],
        ['auth.login', 'SUCCESS'],
        ['auth.password_changed', 'SUCCESS'],
        ['workbook.created', 'SUCCESS'],
        ['workbook.deleted', 'SUCCESS'],
        ['auth.logout_all', 'SUCCESS'],
      ]);
      expect(events[0]).toMatchObject({
        ip: '198.51.100.7',
        userAgent: 'AuditTest/1.0',
        requestId: registered.headers['x-request-id'],
      });
      expect(events[1]?.details).toMatchObject({ reason: 'wrong_password' });
      // The deleted workbook's tasks are gone; the audit record keeps what was removed.
      expect(events[5]).toMatchObject({
        resourceId: wb.body.id,
        details: { name: 'Audited', taskCount: 1 },
      });
      // No secrets in the audit log.
      expect(JSON.stringify(events)).not.toContain(STRONG_PASSWORD);
    });

    it('records failed logins for unknown accounts by email, and refused CSRF requests', async () => {
      const client = await AuthTestClient.create(app);
      const ghost = uniqueEmail('ghost');
      await client.login(ghost).expect(401);
      expect(await audit({ email: ghost })).toEqual([
        expect.objectContaining({
          event: 'auth.login',
          outcome: 'FAILURE',
          userId: null,
          details: { method: 'password', reason: 'unknown_email' },
        }),
      ]);

      const { client: user, userId } = await signedIn('csrf');
      await user.agent.post('/api/workbooks').send({ name: 'No token' }).expect(403);
      const denied = await eventually(() =>
        prisma.auditEvent.findFirst({ where: { event: 'access.denied', userId: null } }),
      );
      expect(denied.outcome).toBe('FAILURE');
      expect(userId).toBeDefined();
    });

    it('is append-only and survives the deletion of the user', async () => {
      const { userId } = await signedIn('survivor');
      const [event] = await audit({ userId });

      await expect(
        prisma.$executeRaw`UPDATE audit_events SET event = 'tampered' WHERE id = ${event!.id}::uuid`,
      ).rejects.toThrow(/append-only/);

      await prisma.user.delete({ where: { id: userId } });
      expect(await audit({ userId })).toHaveLength(1);
    });
  });

  describe('resource limits', () => {
    it('caps the number of entries per workbook', async () => {
      const tasks: unknown = app.get(TasksService);
      const service = tasks as { maxEntriesPerWorkbook: number };
      const original = service.maxEntriesPerWorkbook;
      service.maxEntriesPerWorkbook = 2;
      try {
        const { client } = await signedIn('cap-entries');
        await client.post('/api/workbooks', { name: 'Small' }).expect(201);
        const first = await client.post('/api/tasks', { ...TASK, name: 'One' }).expect(201);
        await client
          .post(`/api/tasks/${first.body.task.id as string}/updates`, {
            entryDate: '2026-11-09',
            description: 'Two',
            status: 'TO_DO',
          })
          .expect(201);

        const full = await client.post('/api/tasks', { ...TASK, name: 'Three' }).expect(409);
        expect(full.body.code).toBe('WORKBOOK_FULL');
      } finally {
        service.maxEntriesPerWorkbook = original;
      }
    });
  });
});
