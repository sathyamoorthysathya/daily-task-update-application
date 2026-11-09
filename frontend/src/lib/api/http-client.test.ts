import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, clearCookies, mockApi, NO_REFRESH } from '../../test/mock-api';
import { ApiError } from './api-error';
import { apiClient } from './http-client';
import { onSessionExpired } from './session-events';

describe('apiClient', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes the API base URL, sends cookies and returns the parsed JSON body', async () => {
    const { spy } = mockApi({ 'GET /health/live': { body: { status: 'ok' } } });

    await expect(apiClient.get('/health/live')).resolves.toEqual({ status: 'ok' });

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('/api/health/live');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('X-CSRF-Token')).toBe(false);
  });

  it('fetches a CSRF token for unsafe requests and sends it as a header with a JSON body', async () => {
    const { requests } = mockApi({ 'POST /items': { status: 201, body: { id: 1 } } });

    await apiClient.post('/items', { name: 'demo' });

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /auth/csrf', 'POST /items']);
    const post = requests[1];
    expect(post?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
    expect(post?.headers.get('Content-Type')).toBe('application/json');
    expect(post?.body).toEqual({ name: 'demo' });

    // The cookie is reused afterwards.
    await apiClient.post('/items', { name: 'again' });
    expect(requests.filter((r) => r.path === '/auth/csrf')).toHaveLength(1);
  });

  it('refreshes the session once on 401 and retries the request', async () => {
    let meCalls = 0;
    const { requests } = mockApi({
      'GET /auth/me': () =>
        ++meCalls === 1 ? apiError(401, 'TOKEN_EXPIRED', 'Expired') : { body: { id: 'u1' } },
      'POST /auth/refresh': { status: 204 },
    });

    await expect(apiClient.get('/auth/me')).resolves.toEqual({ id: 'u1' });

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /auth/me',
      'GET /auth/csrf',
      'POST /auth/refresh',
      'GET /auth/me',
    ]);
  });

  it('shares one refresh between concurrent 401 responses', async () => {
    const seen = new Set<string>();
    const { requests } = mockApi({
      'GET /a': () =>
        seen.has('a') ? { body: 'a' } : (seen.add('a'), apiError(401, 'TOKEN_EXPIRED', 'x')),
      'GET /b': () =>
        seen.has('b') ? { body: 'b' } : (seen.add('b'), apiError(401, 'TOKEN_EXPIRED', 'x')),
      'POST /auth/refresh': { status: 204 },
    });

    await expect(Promise.all([apiClient.get('/a'), apiClient.get('/b')])).resolves.toEqual([
      'a',
      'b',
    ]);
    expect(requests.filter((r) => r.path === '/auth/refresh')).toHaveLength(1);
  });

  it('notifies listeners when the session cannot be refreshed', async () => {
    mockApi({
      'GET /auth/me': apiError(401, 'SESSION_REVOKED', 'Session ended'),
      'POST /auth/refresh': NO_REFRESH,
    });
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(apiClient.get('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not try to refresh when the credentials themselves are rejected', async () => {
    const { requests } = mockApi({
      'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'),
    });

    await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
    });
    expect(requests.some((r) => r.path === '/auth/refresh')).toBe(false);
  });

  it('gets a new CSRF token and retries once when the server rejects it', async () => {
    document.cookie = 'csrf_token=stale; path=/';
    const { requests } = mockApi({
      'POST /items': (req) =>
        req.headers.get('X-CSRF-Token') === 'stale'
          ? apiError(403, 'CSRF_TOKEN_INVALID', 'Invalid CSRF token')
          : { status: 201, body: { ok: true } },
    });

    await expect(apiClient.post('/items')).resolves.toEqual({ ok: true });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /items',
      'GET /auth/csrf',
      'POST /items',
    ]);
  });

  it('exposes the error envelope, code and field errors', async () => {
    mockApi({
      'POST /auth/register': apiError(400, 'VALIDATION_FAILED', 'email: Enter a valid email', {
        errors: [{ field: 'email', message: 'Enter a valid email' }],
      }),
    });

    const error = await apiClient.post('/auth/register', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_FAILED');
    expect((error as ApiError).fieldErrors).toEqual({ email: 'Enter a valid email' });
  });

  it('throws an ApiError with status 0 when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiClient.get('/health/live')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'Unable to reach the API',
    });
  });
});
