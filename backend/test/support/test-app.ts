import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { GOOGLE_OAUTH_CLIENT } from '../../src/modules/auth/google/google-id-token.verifier.js';
import { TEST_EMAIL_DOMAIN } from './auth-test-client.js';
import { FakeGoogleIssuer } from './google-test-tokens.js';

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  google: FakeGoogleIssuer;
  /** Deletes every user created by the tests (and, by cascade, their data). */
  cleanup: () => Promise<void>;
}

/** Boots the real application (real database) with Google's certificates replaced by a test key. */
export async function createTestApp(): Promise<TestApp> {
  const google = new FakeGoogleIssuer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GOOGLE_OAUTH_CLIENT)
    .useValue(google.createClient())
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const prisma = app.get(PrismaService);
  const cleanup = async () => {
    const testEmail = { endsWith: `@${TEST_EMAIL_DOMAIN}` };
    // Audit rows outlive users by design; remove the test accounts' rows explicitly.
    const users = await prisma.user.findMany({ where: { email: testEmail }, select: { id: true } });
    await prisma.auditEvent.deleteMany({
      where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { email: testEmail }] },
    });
    await prisma.user.deleteMany({ where: { email: testEmail } });
  };
  await cleanup();
  return { app, prisma, google, cleanup };
}
