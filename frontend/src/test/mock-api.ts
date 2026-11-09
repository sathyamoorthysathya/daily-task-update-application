import { vi } from 'vitest';

export interface MockRequest {
  method: string;
  path: string;
  /** Query-string parameters of the request URL. */
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  /** Returned as-is (e.g. binary downloads); status/body are ignored. */
  raw?: Response;
}

export type MockHandler = MockResponse | ((request: MockRequest) => MockResponse);

const TEST_CSRF_TOKEN = 'test-csrf-token';

/** Error envelope in the backend's format. */
export function apiError(
  statusCode: number,
  code: string,
  message: string,
  extra = {},
): MockResponse {
  return {
    status: statusCode,
    body: {
      statusCode,
      error: 'Error',
      code,
      message,
      path: '/api',
      method: 'GET',
      timestamp: new Date().toISOString(),
      ...extra,
    },
  };
}

/**
 * Replaces fetch with a router keyed by "METHOD /path" (path without the /api prefix).
 * GET /auth/csrf is built in and sets the csrf_token cookie like the backend does.
 * Unknown routes answer 404. Returns the list of received requests.
 */
export function mockApi(routes: Record<string, MockHandler>) {
  const requests: MockRequest[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api/, '');
    const request: MockRequest = {
      method,
      path,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: new Headers(init?.headers),
    };
    requests.push(request);

    let response: MockResponse;
    const handler = routes[`${method} ${path}`];
    if (handler) {
      response = typeof handler === 'function' ? handler(request) : handler;
    } else if (method === 'GET' && path === '/auth/csrf') {
      document.cookie = `csrf_token=${TEST_CSRF_TOKEN}; path=/`;
      response = { body: { csrfToken: TEST_CSRF_TOKEN } };
    } else {
      response = apiError(404, 'NOT_FOUND', `Cannot ${method} ${path}`);
    }

    await Promise.resolve();
    if (response.raw) {
      return response.raw;
    }
    const status = response.status ?? 200;
    return new Response(
      response.body === undefined || status === 204 ? null : JSON.stringify(response.body),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  });
  return { spy, requests };
}

export function clearCookies(): void {
  for (const cookie of document.cookie.split('; ')) {
    const name = cookie.split('=')[0];
    if (name) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  }
}

export const TEST_USER = {
  id: '0190a000-0000-7000-8000-000000000001',
  email: 'jane@example.com',
  name: 'Jane Doe',
  emailVerified: false,
  hasPassword: true,
  providers: [] as string[],
  avatarVersion: null as number | null,
  providerPictureUrl: null as string | null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const UNAUTHENTICATED = apiError(401, 'UNAUTHENTICATED', 'Authentication required.');
export const NO_REFRESH = apiError(401, 'REFRESH_TOKEN_MISSING', 'Please sign in again.');
