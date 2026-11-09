import { type INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GOOGLE_OAUTH_CLIENT } from '../src/modules/auth/google/google-id-token.verifier.js';
import { PasswordService } from '../src/modules/auth/password/password.service.js';
import { MailService } from '../src/modules/mail/mail.service.js';
import {
  AuthTestClient,
  getSetCookie,
  STRONG_PASSWORD,
  TEST_EMAIL_DOMAIN,
  uniqueEmail,
} from './support/auth-test-client.js';
import { FakeGoogleIssuer, TEST_GOOGLE_CLIENT_ID } from './support/google-test-tokens.js';

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailSpy: MockInstance<MailService['send']>;
  const google = new FakeGoogleIssuer();

  const client = () => AuthTestClient.create(app);

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_OAUTH_CLIENT)
      .useValue(google.createClient())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    mailSpy = vi.spyOn(app.get(MailService), 'send').mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('registration', () => {
    it('creates the user, signs them in with secure cookies and never stores the plain password', async () => {
      const c = await client();
      const email = uniqueEmail('register');

      const res = await c.register(email).expect(201);

      expect(res.body.user).toMatchObject({
        email,
        name: 'Test User',
        emailVerified: false,
        hasPassword: true,
        providers: [],
      });
      const access = getSetCookie(res, 'access_token');
      const refresh = getSetCookie(res, 'refresh_token');
      expect(access?.attributes).toMatch(/HttpOnly/i);
      expect(access?.attributes).toMatch(/Path=\/api(;|$)/);
      expect(access?.attributes).toMatch(/SameSite=Lax/i);
      expect(refresh?.attributes).toMatch(/HttpOnly/i);
      expect(refresh?.attributes).toMatch(/Path=\/api\/auth/);
      expect(refresh?.attributes).toMatch(/SameSite=Strict/i);

      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(STRONG_PASSWORD);
      const token = await prisma.refreshToken.findFirstOrThrow({ where: { userId: stored.id } });
      expect(token.tokenHash).toHaveLength(64);
      expect(token.tokenHash).not.toBe(refresh?.value);

      await c.get('/api/auth/me').expect(200);
    });

    it('rejects a duplicate email, case-insensitively', async () => {
      const c = await client();
      const email = uniqueEmail('dup');
      await c.register(email).expect(201);

      const res = await (await client()).register(email.toUpperCase()).expect(409);

      expect(res.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('validates input and reports field errors', async () => {
      const res = await (
        await client()
      )
        .post('/api/auth/register', { name: '', email: 'not-an-email', password: 'short' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });
  });

  describe('CSRF protection', () => {
    it('rejects state-changing requests without a CSRF token', async () => {
      const c = await client();
      const res = await c.agent
        .post('/api/auth/login')
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(403);

      expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('rejects a header that does not match the cookie', async () => {
      const c = await client();
      const other = await client();
      await c.agent
        .post('/api/auth/login')
        .set('X-CSRF-Token', other.csrfToken)
        .send({ email: uniqueEmail(), password: STRONG_PASSWORD })
        .expect(403);
    });
  });

  describe('login', () => {
    it('signs in with the correct password', async () => {
      const email = uniqueEmail('login');
      await (await client()).register(email);
      const c = await client();

      const res = await c.login(email.toUpperCase()).expect(200);

      expect(res.body.user.email).toBe(email);
      expect(getSetCookie(res, 'access_token')).toBeDefined();
      const me = await c.get('/api/auth/me').expect(200);
      expect(me.body.email).toBe(email);
    });

    it('returns the same generic error for a wrong password and an unknown email', async () => {
      const email = uniqueEmail('wrongpw');
      await (await client()).register(email);

      const wrong = await (await client()).login(email, 'Wrong-pass-123').expect(401);
      const unknown = await (await client()).login(uniqueEmail('nobody')).expect(401);

      for (const res of [wrong, unknown]) {
        expect(res.body).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        });
        expect(getSetCookie(res, 'access_token')).toBeUndefined();
      }
    });

    it('rate-limits repeated attempts for the same email', async () => {
      const c = await client();
      const email = uniqueEmail('ratelimit');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await c.login(email, 'Wrong-pass-123').expect(401);
      }

      const res = await c.login(email, 'Wrong-pass-123').expect(429);

      expect(res.body.message).toMatch(/Too many attempts/);
      expect(res.headers['retry-after-login']).toBeDefined();
      // Other accounts from the same IP are unaffected.
      await c.login(uniqueEmail('other'), 'Wrong-pass-123').expect(401);
    });
  });

  describe('unauthorized access', () => {
    it('rejects requests without an access token', async () => {
      const res = await (await client()).get('/api/auth/me').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a tampered access token', async () => {
      const c = await client();
      const res = await c.register(uniqueEmail('tamper')).expect(201);
      const access = getSetCookie(res, 'access_token')!.value;
      const tampered = `${access.slice(0, -4)}AAAA`;

      const me = await c.rawGet('/api/auth/me', { access_token: tampered }).expect(401);
      expect(me.body.code).toBe('INVALID_TOKEN');
    });

    it('rejects an expired access token, and refresh issues a new one', async () => {
      const c = await client();
      const res = await c.register(uniqueEmail('expired')).expect(201);
      const user = res.body.user as { id: string };
      const access = getSetCookie(res, 'access_token')!.value;
      const { sid } = app.get(JwtService).decode<{ sid: string }>(access);
      const expired = await app
        .get(JwtService)
        .signAsync({ sub: user.id, sid }, { expiresIn: -60 });

      const me = await c.rawGet('/api/auth/me', { access_token: expired }).expect(401);
      expect(me.body.code).toBe('TOKEN_EXPIRED');

      await c.post('/api/auth/refresh').expect(204);
      await c.get('/api/auth/me').expect(200);
    });
  });

  describe('ownership authorization', () => {
    it('lets users read and update only their own profile', async () => {
      const alice = await client();
      const bob = await client();
      const aliceId = (await alice.register(uniqueEmail('alice'))).body.user.id as string;
      const bobId = (await bob.register(uniqueEmail('bob'))).body.user.id as string;

      await alice.get(`/api/users/${aliceId}`).expect(200);
      const updated = await alice.patch(`/api/users/${aliceId}`, { name: 'Alice' }).expect(200);
      expect(updated.body.name).toBe('Alice');

      const read = await alice.get(`/api/users/${bobId}`).expect(403);
      expect(read.body.code).toBe('FORBIDDEN');
      await alice.patch(`/api/users/${bobId}`, { name: 'Hacked' }).expect(403);
      const bobProfile = await bob.get(`/api/users/${bobId}`).expect(200);
      expect(bobProfile.body.name).toBe('Test User');
    });
  });

  describe('refresh token rotation', () => {
    it('rotates tokens and revokes the whole session when an old refresh token is reused', async () => {
      const c = await client();
      const res = await c.register(uniqueEmail('rotate')).expect(201);
      const firstRefresh = getSetCookie(res, 'refresh_token')!.value;

      const rotated = await c.post('/api/auth/refresh').expect(204);
      const secondRefresh = getSetCookie(rotated, 'refresh_token')!.value;
      expect(secondRefresh).not.toBe(firstRefresh);
      await c.get('/api/auth/me').expect(200);

      // An attacker replays the stolen, already-used token.
      const replay = await c
        .rawPost('/api/auth/refresh', { refresh_token: firstRefresh })
        .expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimate session is revoked too: access and refresh tokens stop working.
      const me = await c.get('/api/auth/me').expect(401);
      expect(me.body.code).toBe('SESSION_REVOKED');
      await c.rawPost('/api/auth/refresh', { refresh_token: secondRefresh }).expect(401);
    });

    it('rejects an expired refresh token', async () => {
      const c = await client();
      const email = uniqueEmail('refresh-expired');
      await c.register(email).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await c.post('/api/auth/refresh').expect(401);

      expect(res.body.code).toBe('REFRESH_TOKEN_EXPIRED');
      expect(getSetCookie(res, 'refresh_token')?.attributes).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('requires a refresh token', async () => {
      const res = await (await client()).post('/api/auth/refresh').expect(401);
      expect(res.body.code).toBe('REFRESH_TOKEN_MISSING');
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookies', async () => {
      const c = await client();
      const res = await c.register(uniqueEmail('logout')).expect(201);
      const access = getSetCookie(res, 'access_token')!.value;
      const refresh = getSetCookie(res, 'refresh_token')!.value;

      const out = await c.post('/api/auth/logout').expect(204);

      expect(getSetCookie(out, 'access_token')?.value).toBe('');
      await c.get('/api/auth/me').expect(401);
      // Captured tokens are useless after logout.
      const reuse = await c.rawGet('/api/auth/me', { access_token: access }).expect(401);
      expect(reuse.body.code).toBe('SESSION_REVOKED');
      await c.rawPost('/api/auth/refresh', { refresh_token: refresh }).expect(401);
    });

    it('logout-all ends every session of the user', async () => {
      const email = uniqueEmail('logout-all');
      const laptop = await client();
      const phone = await client();
      await laptop.register(email).expect(201);
      await phone.login(email).expect(200);

      await laptop.post('/api/auth/logout-all').expect(204);

      await laptop.get('/api/auth/me').expect(401);
      await phone.get('/api/auth/me').expect(401);
      await phone.post('/api/auth/refresh').expect(401);
    });
  });

  describe('Google sign-in', () => {
    async function googleLogin(c: AuthTestClient, claims: Parameters<FakeGoogleIssuer['sign']>[0]) {
      const nonceRes = await c.get('/api/auth/google/nonce').expect(200);
      const nonce = nonceRes.body.nonce as string;
      const credential = google.sign({ nonce, ...claims });
      return { res: await c.post('/api/auth/google', { credential }), credential };
    }

    it('advertises the Google provider', async () => {
      const res = await (await client()).get('/api/auth/providers').expect(200);
      expect(res.body).toEqual({ google: { enabled: true, clientId: TEST_GOOGLE_CLIENT_ID } });
    });

    it('creates a verified, password-less account on first sign-in and reuses it afterwards', async () => {
      const email = uniqueEmail('google-new');
      const sub = `sub-${Date.now()}`;
      const c = await client();

      const { res } = await googleLogin(c, { sub, email, name: 'Gina Google' });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        email,
        name: 'Gina Google',
        emailVerified: true,
        hasPassword: false,
        providers: ['google'],
      });
      await c.get('/api/auth/me').expect(200);

      const again = await googleLogin(await client(), { sub, email });
      expect(again.res.status).toBe(200);
      expect(again.res.body.user.id).toBe(res.body.user.id);
      // A Google-only account cannot be signed into with a password.
      await (await client()).login(email, STRONG_PASSWORD).expect(401);
    });

    it('rejects a token whose nonce was not issued to this browser, and nonces are single-use', async () => {
      const c = await client();
      await c.get('/api/auth/google/nonce').expect(200);
      const forged = google.sign({ nonce: 'attacker-nonce', email: uniqueEmail('g') });
      const res = await c.post('/api/auth/google', { credential: forged }).expect(401);
      expect(res.body.code).toBe('GOOGLE_TOKEN_INVALID');

      const { res: ok, credential } = await googleLogin(c, {
        sub: `sub-replay-${Date.now()}`,
        email: uniqueEmail('g'),
      });
      expect(ok.status).toBe(200);
      await c.post('/api/auth/google', { credential }).expect(401);
    });

    it('refuses Google accounts with an unverified email', async () => {
      const { res } = await googleLogin(await client(), {
        sub: `sub-unverified-${Date.now()}`,
        email: uniqueEmail('g-unverified'),
        email_verified: false,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('GOOGLE_EMAIL_NOT_VERIFIED');
    });

    it('rejects tokens for another audience', async () => {
      const c = await client();
      const nonce = (await c.get('/api/auth/google/nonce')).body.nonce as string;
      const credential = google.sign({ nonce, aud: 'another-app.apps.googleusercontent.com' });
      await c.post('/api/auth/google', { credential }).expect(401);
    });

    it('links Google to an existing verified account and keeps its password', async () => {
      const email = uniqueEmail('link-verified');
      await prisma.user.create({
        data: {
          email,
          name: 'Verified',
          emailVerifiedAt: new Date(),
          passwordHash: await app.get(PasswordService).hash(STRONG_PASSWORD),
        },
      });

      const { res } = await googleLogin(await client(), { sub: `sub-link-${Date.now()}`, email });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email, hasPassword: true, providers: ['google'] });
      await (await client()).login(email).expect(200);
    });

    it('protects against account pre-hijacking when linking an unverified account', async () => {
      const email = uniqueEmail('prehijack');
      // An attacker registers the victim's email address with their own password.
      const attacker = await client();
      await attacker.register(email, 'Attack3r-pass').expect(201);

      // The real owner signs in with Google.
      const { res } = await googleLogin(await client(), { sub: `sub-victim-${Date.now()}`, email });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ emailVerified: true, hasPassword: false });
      // The attacker's session and password no longer work.
      await attacker.get('/api/auth/me').expect(401);
      await (await client()).login(email, 'Attack3r-pass').expect(401);
    });
  });

  describe('password reset', () => {
    function lastResetToken(email: string): string {
      const call = mailSpy.mock.calls.findLast(([message]) => message.to === email);
      const text = call?.[0].text ?? '';
      const match = /reset-password\?token=([^\s]+)/.exec(text);
      return decodeURIComponent(match?.[1] ?? '');
    }

    it('answers identically for unknown emails and sends nothing', async () => {
      mailSpy.mockClear();
      const res = await (
        await client()
      )
        .post('/api/auth/forgot-password', { email: uniqueEmail('ghost') })
        .expect(202);

      expect(res.body.message).toMatch(/If an account exists/);
      expect(mailSpy).not.toHaveBeenCalled();
    });

    it('resets the password with a single-use link and ends existing sessions', async () => {
      const email = uniqueEmail('reset');
      const session = await client();
      await session.register(email).expect(201);

      await (await client()).post('/api/auth/forgot-password', { email }).expect(202);
      await vi.waitFor(() => expect(lastResetToken(email)).not.toBe(''));
      const token = lastResetToken(email);
      const stored = await prisma.passwordResetToken.findFirstOrThrow({
        where: { user: { email } },
      });
      expect(stored.tokenHash).not.toBe(token);

      const c = await client();
      const weak = await c
        .post('/api/auth/reset-password', { token, password: 'weak' })
        .expect(400);
      expect(weak.body.code).toBe('VALIDATION_FAILED');

      await c.post('/api/auth/reset-password', { token, password: 'Brand-new-pass-9' }).expect(204);

      await session.get('/api/auth/me').expect(401);
      await (await client()).login(email).expect(401);
      const login = await (await client()).login(email, 'Brand-new-pass-9').expect(200);
      expect(login.body.user.emailVerified).toBe(true);

      const reuse = await c
        .post('/api/auth/reset-password', { token, password: 'Another-pass-10' })
        .expect(400);
      expect(reuse.body.code).toBe('RESET_TOKEN_INVALID');
    });

    it('rejects an expired reset link', async () => {
      const email = uniqueEmail('reset-expired');
      await (await client()).register(email).expect(201);
      await (await client()).post('/api/auth/forgot-password', { email }).expect(202);
      await vi.waitFor(() => expect(lastResetToken(email)).not.toBe(''));
      await prisma.passwordResetToken.updateMany({
        where: { user: { email } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await (
        await client()
      )
        .post('/api/auth/reset-password', {
          token: lastResetToken(email),
          password: 'Brand-new-pass-9',
        })
        .expect(400);
      expect(res.body.code).toBe('RESET_TOKEN_INVALID');
    });
  });
});
