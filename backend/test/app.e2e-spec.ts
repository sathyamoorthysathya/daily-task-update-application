import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Requires PostgreSQL to be running (`npm run db:up` from the repository root).
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live reports the process as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/live').expect(200);

    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /api/health reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
      path: '/api/does-not-exist',
      method: 'GET',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('allows CORS requests from the configured frontend origin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);

    expect(res.body.info.title).toBe('Daily Task Update API');
    expect(Object.keys(res.body.paths as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['/api/health', '/api/health/live']),
    );
  });
});
