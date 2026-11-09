import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types.js';

export const TEST_EMAIL_DOMAIN = 'e2e.test';
export const STRONG_PASSWORD = 'Sup3r-secret-pass';

let counter = 0;
export function uniqueEmail(label = 'user'): string {
  counter += 1;
  return `${label}.${Date.now()}.${counter}@${TEST_EMAIL_DOMAIN}`;
}

export interface ParsedCookie {
  value: string;
  attributes: string;
}

/** Reads a cookie from the Set-Cookie headers of a response. */
export function getSetCookie(res: Response, name: string): ParsedCookie | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = header?.find((cookie) => cookie.startsWith(`${name}=`));
  if (!line) {
    return undefined;
  }
  const [pair = '', ...attributes] = line.split(';');
  return {
    value: decodeURIComponent(pair.slice(name.length + 1)),
    attributes: attributes.join(';'),
  };
}

/**
 * A browser-like client: keeps cookies between requests (supertest agent) and sends the
 * CSRF token header on unsafe requests, like the SPA does.
 */
export class AuthTestClient {
  readonly agent: ReturnType<typeof request.agent>;
  csrfToken = '';

  constructor(private readonly app: INestApplication<App>) {
    this.agent = request.agent(app.getHttpServer());
  }

  static async create(app: INestApplication<App>): Promise<AuthTestClient> {
    const client = new AuthTestClient(app);
    const res = await client.agent.get('/api/auth/csrf').expect(200);
    client.csrfToken = (res.body as { csrfToken: string }).csrfToken;
    return client;
  }

  get(url: string) {
    return this.agent.get(url);
  }

  post(url: string, body?: object) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrfToken).send(body);
  }

  patch(url: string, body?: object) {
    return this.agent.patch(url).set('X-CSRF-Token', this.csrfToken).send(body);
  }

  register(email: string, password = STRONG_PASSWORD, name = 'Test User') {
    return this.post('/api/auth/register', { name, email, password });
  }

  login(email: string, password = STRONG_PASSWORD) {
    return this.post('/api/auth/login', { email, password });
  }

  /** Sends a request with exactly the given cookies (plus a valid CSRF pair), bypassing the jar. */
  rawPost(url: string, cookies: Record<string, string>) {
    const all = { ...cookies, csrf_token: this.csrfToken };
    return request(this.app.getHttpServer())
      .post(url)
      .set(
        'Cookie',
        Object.entries(all).map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
      )
      .set('X-CSRF-Token', this.csrfToken);
  }

  rawGet(url: string, cookies: Record<string, string>) {
    return request(this.app.getHttpServer())
      .get(url)
      .set(
        'Cookie',
        Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
      );
  }
}
