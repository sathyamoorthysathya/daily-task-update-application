import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { AuthTestClient, STRONG_PASSWORD, uniqueEmail } from './support/auth-test-client.js';
import type { FakeGoogleIssuer } from './support/google-test-tokens.js';
import { createTestApp } from './support/test-app.js';

interface Profile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  companyName: string | null;
  jobRole: string | null;
  industry: string | null;
  yearsOfExperience: number | null;
  avatarVersion: number | null;
  hasPassword: boolean;
  connectedAccounts: { provider: string; email: string | null; pictureUrl: string | null }[];
  createdAt: string;
}

const FULL_PROFILE = {
  name: 'Jane Doe',
  phone: '+44 20 7946 0958',
  companyName: 'Acme Corp',
  jobRole: 'Engineering Manager',
  industry: 'Information Technology',
  yearsOfExperience: 12,
};

function png(width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: '#e91e63' } })
    .png()
    .toBuffer();
}

// Requires PostgreSQL with migrations applied (`npm run prisma:deploy -w backend`).
describe('Profile management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let google: FakeGoogleIssuer;
  let cleanup: () => Promise<void>;

  async function signedInUser(label = 'profile') {
    const client = await AuthTestClient.create(app);
    const email = uniqueEmail(label);
    const res = await client.register(email, STRONG_PASSWORD, 'Original Name').expect(201);
    return { client, email, id: (res.body as { user: { id: string } }).user.id };
  }

  beforeAll(async () => {
    ({ app, prisma, google, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe('profile creation and retrieval', () => {
    it('creates an empty profile at registration and returns it for the signed-in user', async () => {
      const { client, email, id } = await signedInUser();

      expect(await prisma.userProfile.findUnique({ where: { userId: id } })).not.toBeNull();
      const res = await client.get('/api/profile').expect(200);
      const profile = res.body as Profile;

      expect(profile).toMatchObject({
        id,
        email,
        name: 'Original Name',
        phone: null,
        companyName: null,
        jobRole: null,
        industry: null,
        yearsOfExperience: null,
        avatarVersion: null,
        hasPassword: true,
        connectedAccounts: [],
      });
      expect(Date.now() - new Date(profile.createdAt).getTime()).toBeLessThan(60_000);
    });

    it('creates a profile for Google sign-ups and shows the connected Google account', async () => {
      const client = await AuthTestClient.create(app);
      const email = uniqueEmail('google-profile');
      const nonce = (await client.get('/api/auth/google/nonce')).body.nonce as string;
      const credential = google.sign({
        nonce,
        sub: `sub-profile-${Date.now()}`,
        email,
        name: 'Gina Google',
        picture: 'https://lh3.googleusercontent.com/a/test-picture',
      });
      await client.post('/api/auth/google', { credential }).expect(200);

      const profile = (await client.get('/api/profile').expect(200)).body as Profile;

      expect(profile).toMatchObject({ email, name: 'Gina Google', hasPassword: false });
      expect(profile.connectedAccounts).toEqual([
        expect.objectContaining({
          provider: 'google',
          email,
          name: 'Gina Google',
          pictureUrl: 'https://lh3.googleusercontent.com/a/test-picture',
          connectedAt: expect.any(String) as unknown,
          lastLoginAt: expect.any(String) as unknown,
        }),
      ]);
    });

    it('lists the allowed industries', async () => {
      const { client } = await signedInUser();
      const res = await client.get('/api/profile/industries').expect(200);
      expect(res.body.industries).toContain('Information Technology');
    });
  });

  describe('editing and persistence', () => {
    it('updates every field and persists the changes in PostgreSQL', async () => {
      const { client, id } = await signedInUser('edit');

      const res = await client.patch('/api/profile', FULL_PROFILE).expect(200);
      expect(res.body).toMatchObject(FULL_PROFILE);

      // Fresh read through the API and directly from the database.
      expect((await client.get('/api/profile').expect(200)).body).toMatchObject(FULL_PROFILE);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id },
        include: { profile: true },
      });
      expect(row.name).toBe('Jane Doe');
      expect(row.profile).toMatchObject({
        phone: '+44 20 7946 0958',
        companyName: 'Acme Corp',
        jobRole: 'Engineering Manager',
        industry: 'Information Technology',
        yearsOfExperience: 12,
      });
      // The session summary reflects the new name too.
      expect((await client.get('/api/auth/me')).body.name).toBe('Jane Doe');
    });

    it('applies partial updates and clears optional fields', async () => {
      const { client } = await signedInUser('partial');
      await client.patch('/api/profile', FULL_PROFILE).expect(200);

      await client.patch('/api/profile', { jobRole: 'Director' }).expect(200);
      let profile = (await client.get('/api/profile')).body as Profile;
      expect(profile).toMatchObject({ ...FULL_PROFILE, jobRole: 'Director' });

      await client
        .patch('/api/profile', { phone: '', companyName: null, yearsOfExperience: null })
        .expect(200);
      profile = (await client.get('/api/profile')).body as Profile;
      expect(profile).toMatchObject({ phone: null, companyName: null, yearsOfExperience: null });
      expect(profile.jobRole).toBe('Director');
    });

    it('validates input and returns field errors', async () => {
      const { client } = await signedInUser('invalid');

      const res = await client
        .patch('/api/profile', {
          name: '',
          phone: 'not-a-phone',
          industry: 'Space Piracy',
          yearsOfExperience: 99,
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      const fields = (res.body.errors as { field: string }[]).map((e) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'phone', 'industry', 'yearsOfExperience']),
      );
    });

    it('does not allow the email address or other protected fields to be changed', async () => {
      const { client, email } = await signedInUser('protected');

      const res = await client
        .patch('/api/profile', { name: 'Hacker', email: 'takeover@e2e.test', emailVerified: true })
        .expect(400);

      expect(res.body.message).toEqual(['Field cannot be changed: email, emailVerified']);
      const profile = (await client.get('/api/profile')).body as Profile;
      expect(profile).toMatchObject({ email, name: 'Original Name' });
    });
  });

  describe('avatar', () => {
    it('uploads, serves, replaces and removes the profile picture', async () => {
      const { client, id } = await signedInUser('avatar');

      const upload = await client.agent
        .put('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .attach('avatar', await png(), { filename: 'me.png', contentType: 'image/png' })
        .expect(200);
      const firstVersion = (upload.body as Profile).avatarVersion;
      expect(firstVersion).toEqual(expect.any(Number));

      const image = await client.get('/api/profile/avatar').expect(200);
      expect(image.headers['content-type']).toBe('image/webp');
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      const meta = await sharp(image.body as Buffer).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
      const stored = await prisma.userAvatar.findUniqueOrThrow({ where: { userId: id } });
      expect(stored.mimeType).toBe('image/webp');

      await new Promise((resolve) => setTimeout(resolve, 5));
      const replaced = await client.agent
        .put('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .attach('avatar', await png(300, 300), { filename: 'new.png', contentType: 'image/png' })
        .expect(200);
      expect((replaced.body as Profile).avatarVersion).toBeGreaterThan(firstVersion ?? 0);

      const removed = await client.agent
        .delete('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .expect(200);
      expect((removed.body as Profile).avatarVersion).toBeNull();
      await client.get('/api/profile/avatar').expect(404);
    });

    it('rejects non-image files, even with an image name and MIME type', async () => {
      const { client } = await signedInUser('avatar-bad');

      const res = await client.agent
        .put('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .attach('avatar', Buffer.from('<script>alert(1)</script>'), {
          filename: 'evil.png',
          contentType: 'image/png',
        })
        .expect(400);

      expect(res.body.code).toBe('AVATAR_INVALID_TYPE');
    });

    it('rejects files larger than 2 MB', async () => {
      const { client } = await signedInUser('avatar-big');

      await client.agent
        .put('/api/profile/avatar')
        .set('X-CSRF-Token', client.csrfToken)
        .attach('avatar', Buffer.alloc(2 * 1024 * 1024 + 1, 1), {
          filename: 'big.png',
          contentType: 'image/png',
        })
        .expect(413);
    });
  });

  describe('authorization', () => {
    it('requires authentication for every profile endpoint', async () => {
      const anonymous = await AuthTestClient.create(app);

      await anonymous.get('/api/profile').expect(401);
      await anonymous.patch('/api/profile', { name: 'X' }).expect(401);
      await anonymous.get('/api/profile/avatar').expect(401);
      await anonymous.post('/api/auth/change-password', {}).expect(401);
    });

    it('requires a CSRF token to modify the profile', async () => {
      const { client } = await signedInUser('csrf');
      await client.agent.patch('/api/profile').send({ name: 'X' }).expect(403);
    });

    it('serves each user only their own profile', async () => {
      const alice = await signedInUser('alice');
      const bob = await signedInUser('bob');
      await bob.client.patch('/api/profile', { companyName: 'Bob Inc' }).expect(200);

      const aliceView = (await alice.client.get('/api/profile')).body as Profile;
      expect(aliceView.id).toBe(alice.id);
      expect(aliceView.companyName).toBeNull();

      // ID-based access is owner-only.
      await alice.client.get(`/api/users/${alice.id}`).expect(200);
      const forbidden = await alice.client.get(`/api/users/${bob.id}`).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await alice.client.patch(`/api/users/${bob.id}`, { companyName: 'Hacked' }).expect(403);

      const bobRow = await prisma.userProfile.findUniqueOrThrow({ where: { userId: bob.id } });
      expect(bobRow.companyName).toBe('Bob Inc');
    });
  });

  describe('change password', () => {
    it('changes the password, keeps this session and signs out other sessions', async () => {
      const { client, email } = await signedInUser('change-pw');
      const otherDevice = await AuthTestClient.create(app);
      await otherDevice.login(email).expect(200);

      await client
        .post('/api/auth/change-password', {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'Changed-pass-42',
        })
        .expect(204);

      await client.get('/api/profile').expect(200);
      await otherDevice.get('/api/profile').expect(401);
      await (await AuthTestClient.create(app)).login(email).expect(401);
      await (await AuthTestClient.create(app)).login(email, 'Changed-pass-42').expect(200);
    });

    it('rejects a wrong current password without ending the session', async () => {
      const { client } = await signedInUser('wrong-current');

      const res = await client
        .post('/api/auth/change-password', {
          currentPassword: 'Not-my-pass-1',
          newPassword: 'Changed-pass-42',
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(res.body.errors).toEqual([
        { field: 'currentPassword', message: 'Current password is incorrect.' },
      ]);
      await client.get('/api/profile').expect(200);
    });

    it('enforces the password policy and requires a different password', async () => {
      const { client } = await signedInUser('policy');

      const weak = await client
        .post('/api/auth/change-password', {
          currentPassword: STRONG_PASSWORD,
          newPassword: 'weak',
        })
        .expect(400);
      expect(weak.body.code).toBe('VALIDATION_FAILED');

      const same = await client
        .post('/api/auth/change-password', {
          currentPassword: STRONG_PASSWORD,
          newPassword: STRONG_PASSWORD,
        })
        .expect(400);
      expect(same.body.code).toBe('PASSWORD_UNCHANGED');
    });

    it('explains that Google-only accounts must set a password via email', async () => {
      const client = await AuthTestClient.create(app);
      const nonce = (await client.get('/api/auth/google/nonce')).body.nonce as string;
      const credential = google.sign({
        nonce,
        sub: `sub-nopw-${Date.now()}`,
        email: uniqueEmail('google-nopw'),
      });
      await client.post('/api/auth/google', { credential }).expect(200);

      const res = await client
        .post('/api/auth/change-password', {
          currentPassword: 'anything',
          newPassword: 'Changed-pass-42',
        })
        .expect(400);
      expect(res.body.code).toBe('PASSWORD_NOT_SET');
    });
  });
});
