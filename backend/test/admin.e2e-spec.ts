import { randomUUID } from 'node:crypto';
import { AdminAuthService } from '../src/modules/admin/auth/admin-auth.service.js';
import { base32Decode, hotp, totpStep } from '../src/modules/admin/auth/totp.js';
import {
  AuthTestClient,
  getSetCookie,
  STRONG_PASSWORD,
  uniqueEmail,
} from './support/auth-test-client.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const ADMIN_PREFIX = 'e2e-admin-';
const ADMIN_PASSWORD = 'Adm1n-e2e-Pass!word';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let adminCounter = 0;
const uniqueAdmin = () => `${ADMIN_PREFIX}${Date.now() % 1_000_000}-${++adminCounter}`;

/** TOTP code for the given step offset from now (0 = current 30-second window). */
const codeFor = (secret: string, offset = 0) =>
  hotp(base32Decode(secret), totpStep() + BigInt(offset));

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Admin panel (e2e)', () => {
  let t: TestApp;
  const visitorIds: string[] = [];

  async function createAdmin(username = uniqueAdmin()) {
    await t.app.get(AdminAuthService).createAdmin(username, 'E2E Admin', ADMIN_PASSWORD, 'cli');
    return username;
  }

  async function signedInAdmin(username?: string) {
    const name = username ?? (await createAdmin());
    const c = await AuthTestClient.create(t.app);
    await c
      .post('/api/v1/admin/auth/login', { username: name, password: ADMIN_PASSWORD })
      .expect(200);
    return { c, username: name };
  }

  async function cleanupAdmins() {
    const admins = await t.prisma.adminUser.findMany({
      where: { username: { startsWith: ADMIN_PREFIX } },
      select: { id: true },
    });
    const ids = admins.map((admin) => admin.id);
    await t.prisma.auditEvent.deleteMany({ where: { adminId: { in: ids } } });
    await t.prisma.auditEvent.deleteMany({
      where: {
        event: 'admin.login',
        details: { path: ['username'], string_starts_with: ADMIN_PREFIX },
      },
    });
    await t.prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
    await t.prisma.pageView.deleteMany({ where: { visitorId: { in: visitorIds } } });
  }

  beforeAll(async () => {
    t = await createTestApp();
    await cleanupAdmins();
  });

  afterAll(async () => {
    await cleanupAdmins();
    await t.cleanup();
    await t.app.close();
  });

  describe('sign-in', () => {
    it('signs in with a unique username and sets a strict, HttpOnly session cookie', async () => {
      const username = await createAdmin();
      const c = await AuthTestClient.create(t.app);
      const res = await c
        .post('/api/v1/admin/auth/login', {
          username: username.toUpperCase(),
          password: ADMIN_PASSWORD,
        })
        .expect(200);
      const body = res.body as { admin: { username: string; twoFactorEnabled: boolean } };
      expect(body.admin).toMatchObject({ username, twoFactorEnabled: false });

      const cookie = getSetCookie(res, 'admin_session');
      expect(cookie?.attributes).toMatch(/HttpOnly/i);
      expect(cookie?.attributes).toMatch(/SameSite=Strict/i);
      expect(cookie?.attributes).toMatch(/Path=\/api\/v1\/admin/);

      const me = await c.get('/api/v1/admin/auth/me').expect(200);
      expect(me.body).toMatchObject({ username, session: { idleTimeoutMinutes: 30 } });

      // The session token is stored only as a hash.
      const stored = await t.prisma.adminSession.findMany({
        where: { admin: { username } },
        select: { tokenHash: true },
      });
      expect(stored.map((s) => s.tokenHash)).not.toContain(cookie?.value);
    });

    it('answers 401 with the same message for a wrong password and an unknown username', async () => {
      const username = await createAdmin();
      const c = await AuthTestClient.create(t.app);
      const wrong = await c
        .post('/api/v1/admin/auth/login', { username, password: 'Wrong-pass-123!' })
        .expect(401);
      const unknown = await c
        .post('/api/v1/admin/auth/login', { username: uniqueAdmin(), password: 'Wrong-pass-123!' })
        .expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect((unknown.body as { message: string }).message).toBe(
        (wrong.body as { message: string }).message,
      );
      await c.post('/api/v1/admin/auth/login', { username: '', password: '' }).expect(422);
    });

    it('requires the CSRF token', async () => {
      const username = await createAdmin();
      await (
        await AuthTestClient.create(t.app)
      ).agent
        .post('/api/v1/admin/auth/login')
        .send({ username, password: ADMIN_PASSWORD })
        .expect(403);
    });

    it('locks the account after repeated failures (429 with Retry-After)', async () => {
      const username = await createAdmin();
      const c = await AuthTestClient.create(t.app);
      for (let attempt = 1; attempt <= 5; attempt++) {
        await c
          .post('/api/v1/admin/auth/login', { username, password: `Wrong-pass-${attempt}!` })
          .set('X-Forwarded-For', `198.51.100.${attempt}`)
          .expect(401);
      }
      // Even the right password is refused while locked.
      const locked = await c
        .post('/api/v1/admin/auth/login', { username, password: ADMIN_PASSWORD })
        .set('X-Forwarded-For', '198.51.100.20')
        .expect(429);
      expect(locked.body).toMatchObject({ code: 'ACCOUNT_LOCKED' });
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

      const admin = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
      expect(admin.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(
        await t.prisma.auditEvent.count({ where: { event: 'admin.locked', adminId: admin.id } }),
      ).toBe(1);
    });

    it('keeps admin and user sessions apart', async () => {
      // An application user's session does not open the admin API.
      const user = await AuthTestClient.create(t.app);
      await user.register(uniqueEmail('not-admin')).expect(201);
      const denied = await user.get('/api/v1/admin/overview').expect(401);
      expect(denied.body).toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });

      // An admin session does not open the user API.
      const { c } = await signedInAdmin();
      await c.get('/api/v1/auth/me').expect(401);
    });

    it('ends idle sessions and signs out', async () => {
      const { c, username } = await signedInAdmin();
      await t.prisma.adminSession.updateMany({
        where: { admin: { username } },
        data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
      });
      const expired = await c.get('/api/v1/admin/auth/me').expect(401);
      expect(expired.body).toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' });

      const again = await signedInAdmin(username);
      const out = await again.c.post('/api/v1/admin/auth/logout').expect(204);
      expect(getSetCookie(out, 'admin_session')?.value).toBe('');
      await again.c.get('/api/v1/admin/auth/me').expect(401);
    });
  });

  describe('two-step verification', () => {
    it('is set up with an authenticator code and then required at sign-in', async () => {
      const { c, username } = await signedInAdmin();
      await c
        .post('/api/v1/admin/auth/two-factor/setup', { password: 'Not-my-pass-123!' })
        .expect(422);
      const setup = await c
        .post('/api/v1/admin/auth/two-factor/setup', { password: ADMIN_PASSWORD })
        .expect(200);
      const { secret, otpauthUri } = setup.body as { secret: string; otpauthUri: string };
      expect(otpauthUri).toContain(`secret=${secret}`);

      // The secret is stored encrypted.
      const stored = await t.prisma.adminUser.findUniqueOrThrow({ where: { username } });
      expect(stored.totpSecret).not.toContain(secret);

      await c.post('/api/v1/admin/auth/two-factor/enable', { code: '000000' }).expect(422);
      await c.post('/api/v1/admin/auth/two-factor/enable', { code: codeFor(secret) }).expect(204);
      expect((await c.get('/api/v1/admin/auth/me').expect(200)).body).toMatchObject({
        twoFactorEnabled: true,
      });

      const next = await AuthTestClient.create(t.app);
      const login = (code?: string) =>
        next.post('/api/v1/admin/auth/login', { username, password: ADMIN_PASSWORD, code });
      expect((await login().expect(401)).body).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
      expect((await login('123456').expect(401)).body).toMatchObject({
        code: 'TWO_FACTOR_INVALID',
      });
      // The code used to turn it on cannot be used again; the next window's code works.
      expect((await login(codeFor(secret)).expect(401)).body).toMatchObject({
        code: 'TWO_FACTOR_INVALID',
      });
      const nextCode = codeFor(secret, 1);
      await login(nextCode).expect(200);
      // ...once.
      await (
        await AuthTestClient.create(t.app)
      )
        .post('/api/v1/admin/auth/login', { username, password: ADMIN_PASSWORD, code: nextCode })
        .set('X-Forwarded-For', '198.51.100.77')
        .expect(401);
    });
  });

  describe('account', () => {
    it('changes the password (strong policy) and signs out the other sessions', async () => {
      const first = await signedInAdmin();
      const second = await signedInAdmin(first.username);

      await first.c
        .post('/api/v1/admin/auth/change-password', {
          currentPassword: 'Wrong-pass-123!',
          newPassword: 'An0ther-Strong-Pass!',
        })
        .expect(422);
      const weak = await first.c
        .post('/api/v1/admin/auth/change-password', {
          currentPassword: ADMIN_PASSWORD,
          newPassword: 'weakpassword',
        })
        .expect(422);
      expect((weak.body as { errors: { field: string }[] }).errors[0]?.field).toBe('newPassword');

      await first.c
        .post('/api/v1/admin/auth/change-password', {
          currentPassword: ADMIN_PASSWORD,
          newPassword: 'An0ther-Strong-Pass!',
        })
        .expect(204);
      await first.c.get('/api/v1/admin/auth/me').expect(200);
      await second.c.get('/api/v1/admin/auth/me').expect(401);

      const admins = await first.c.get('/api/v1/admin/auth/admins').expect(200);
      const list = (admins.body as { admins: { username: string }[] }).admins;
      expect(list.map((a) => a.username)).toContain(first.username);
      expect(JSON.stringify(admins.body)).not.toMatch(/passwordHash|totpSecret/);
    });
  });

  describe('users', () => {
    it('lists, searches and shows a user with their usage and sessions', async () => {
      const email = uniqueEmail('managed');
      const user = await AuthTestClient.create(t.app);
      await user.register(email, STRONG_PASSWORD, 'Managed Person').expect(201);
      const { c } = await signedInAdmin();

      const list = await c
        .get(`/api/v1/admin/users?search=${encodeURIComponent(email)}`)
        .expect(200);
      const page = list.body as { items: { id: string; email: string }[]; total: number };
      expect(page.total).toBe(1);
      const id = page.items[0]!.id;
      expect(page.items[0]).toMatchObject({ email, disabled: false, workbooks: 0 });

      const detail = await c.get(`/api/v1/admin/users/${id}`).expect(200);
      expect(detail.body).toMatchObject({
        email,
        name: 'Managed Person',
        sessions: [expect.objectContaining({ browser: expect.any(String) })],
      });

      await c.get(`/api/v1/admin/users/${randomUUID()}`).expect(404);
      await c.get('/api/v1/admin/users/not-a-uuid').expect(422);
      await c.get('/api/v1/admin/users?status=nope').expect(422);
    });

    it('disables a user (signed out, cannot sign in) and enables them again', async () => {
      const email = uniqueEmail('disabled');
      const user = await AuthTestClient.create(t.app);
      await user.register(email).expect(201);
      const { id } = (await user.get('/api/v1/auth/me').expect(200)).body as { id: string };
      const { c } = await signedInAdmin();

      const disabled = await c
        .post(`/api/v1/admin/users/${id}/disable`, { reason: 'Left the company' })
        .expect(200);
      expect(disabled.body).toMatchObject({ disabled: true, disabledReason: 'Left the company' });

      // Signed out at once, and sign-in is refused (only after the password was checked).
      await user.get('/api/v1/auth/me').expect(401);
      const refused = await (await AuthTestClient.create(t.app)).login(email).expect(403);
      expect(refused.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
      await (await AuthTestClient.create(t.app)).login(email, 'Wrong-pass-1').expect(401);

      await c.post(`/api/v1/admin/users/${id}/enable`).expect(200);
      const back = await AuthTestClient.create(t.app);
      await back.login(email).expect(200);

      const out = await c.post(`/api/v1/admin/users/${id}/sign-out`).expect(200);
      expect(out.body).toEqual({ revoked: 1 });
      await back.get('/api/v1/auth/me').expect(401);

      const audit = await t.prisma.auditEvent.findMany({
        where: { userId: id, event: { startsWith: 'admin.' } },
        select: { event: true, adminId: true },
      });
      expect(audit.map((e) => e.event).sort()).toEqual([
        'admin.user_disabled',
        'admin.user_enabled',
        'admin.user_signed_out',
      ]);
      expect(audit.every((e) => e.adminId !== null)).toBe(true);
    });
  });

  describe('page visits and insights', () => {
    it('records which pages users open, without IDs, query strings or admin pages', async () => {
      const user = await AuthTestClient.create(t.app);
      const email = uniqueEmail('visitor');
      await user.register(email).expect(201);
      const { id: userId } = (await user.get('/api/v1/auth/me').expect(200)).body as {
        id: string;
      };
      const visitorId = randomUUID();
      visitorIds.push(visitorId);
      const visit = (path: string, ua = CHROME) =>
        user.post('/api/v1/analytics/page-views', { path, visitorId }).set('User-Agent', ua);

      await visit(`/tasks/${randomUUID()}?search=secret`).expect(204);
      await visit('/dashboard').expect(204);
      await visit('/admin/users').expect(204); // ignored
      await visit('/dashboard', 'curl/8.0').expect(204); // bots ignored
      await user
        .post('/api/v1/analytics/page-views', { path: '/x', visitorId: 'nope' })
        .expect(422);

      const rows = await t.prisma.pageView.findMany({
        where: { visitorId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.path)).toEqual(['/tasks/:id', '/dashboard']);
      expect(rows[0]).toMatchObject({
        userId,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Windows',
      });

      // Signed-out visits count too (no user).
      const guestVisitor = randomUUID();
      visitorIds.push(guestVisitor);
      await (
        await AuthTestClient.create(t.app)
      )
        .post('/api/v1/analytics/page-views', { path: '/login', visitorId: guestVisitor })
        .set('User-Agent', CHROME)
        .expect(204);

      const { c } = await signedInAdmin();
      const activity = await c.get('/api/v1/admin/activity?days=7&tz=Asia/Kolkata').expect(200);
      const body = activity.body as {
        totals: { views: number };
        daily: { date: string }[];
        pages: { path: string }[];
        hours: number[];
      };
      expect(body.daily).toHaveLength(7);
      expect(body.hours).toHaveLength(24);
      expect(body.totals.views).toBeGreaterThanOrEqual(3);
      expect(body.pages.map((p) => p.path)).toEqual(
        expect.arrayContaining(['/tasks/:id', '/dashboard', '/login']),
      );

      const visits = await c.get(`/api/v1/admin/activity/visits?userId=${userId}`).expect(200);
      const log = visits.body as {
        items: { path: string; user: { email: string } }[];
        total: number;
      };
      expect(log.total).toBe(2);
      expect(log.items[0]).toMatchObject({ path: '/dashboard', user: { email } });

      const detail = await c.get(`/api/v1/admin/users/${userId}`).expect(200);
      expect(detail.body).toMatchObject({ last30Days: { views: 2 } });
      expect((detail.body as { lastSeenAt: string | null }).lastSeenAt).not.toBeNull();

      await c.get('/api/v1/admin/activity?tz=Mars/Base').expect(422);
    });

    it('summarises the application on the overview', async () => {
      const { c } = await signedInAdmin();
      const res = await c.get('/api/v1/admin/overview?days=14&tz=UTC').expect(200);
      const body = res.body as {
        users: { total: number };
        daily: { date: string; signups: number }[];
        security: Record<string, number>;
      };
      expect(body.users.total).toBeGreaterThan(0);
      expect(body.daily).toHaveLength(14);
      expect(body.daily.at(-1)?.date).toBe(new Date().toISOString().slice(0, 10));
      expect(body.security).toHaveProperty('failedSignInsLastDay');
    });
  });

  describe('security', () => {
    it('shows failed sign-ins, the addresses they came from and the audit log', async () => {
      const email = uniqueEmail('targeted');
      const user = await AuthTestClient.create(t.app);
      await user.register(email).expect(201);
      await (
        await AuthTestClient.create(t.app)
      )
        .login(email, 'Wrong-pass-1')
        .set('X-Forwarded-For', '203.0.113.99')
        .expect(401);

      const { c } = await signedInAdmin();
      const summary = await c.get('/api/v1/admin/security?days=1').expect(200);
      const body = summary.body as {
        totals: { failedSignIns: number };
        topFailedIps: { ip: string }[];
        targetedAccounts: { account: string }[];
        failureReasons: { reason: string }[];
      };
      expect(body.totals.failedSignIns).toBeGreaterThan(0);
      expect(body.topFailedIps.map((row) => row.ip)).toContain('203.0.113.99');
      expect(body.targetedAccounts.map((row) => row.account)).toContain(email);
      expect(body.failureReasons.map((row) => row.reason)).toContain('wrong_password');

      const events = await c
        .get(`/api/v1/admin/security/events?search=${encodeURIComponent(email)}&outcome=FAILURE`)
        .expect(200);
      const log = events.body as { items: { event: string; user: { email: string } | null }[] };
      expect(log.items[0]).toMatchObject({ event: 'auth.login', user: { email } });

      const adminEvents = await c
        .get('/api/v1/admin/security/events?category=admin&pageSize=5')
        .expect(200);
      const items = (adminEvents.body as { items: { event: string; admin: unknown }[] }).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.event.startsWith('admin.'))).toBe(true);
    });
  });
});
