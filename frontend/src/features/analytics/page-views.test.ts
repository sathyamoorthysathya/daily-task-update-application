import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCookies, mockApi } from '../../test/mock-api';

// Tracking is off in tests by default; these tests turn it on.
vi.mock('../../config/env', () => ({
  env: { apiBaseUrl: '/api/v1', analyticsEnabled: true },
}));

const { reportPageView, visitorId } = await import('./page-views');

describe('page-visit tracking', () => {
  beforeEach(() => {
    clearCookies();
    try {
      window.localStorage.clear();
    } catch {
      // No storage in this environment: the visitor ID is kept in memory.
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the page path with a stable random visitor ID', async () => {
    const { requests } = mockApi({ 'POST /analytics/page-views': { status: 204 } });
    reportPageView('/tasks');

    await vi.waitFor(() =>
      expect(requests.filter((r) => r.path === '/analytics/page-views')).toHaveLength(1),
    );
    const body = requests.find((r) => r.path === '/analytics/page-views')?.body as {
      path: string;
      visitorId: string;
    };
    expect(body.path).toBe('/tasks');
    expect(body.visitorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(visitorId()).toBe(body.visitorId);
  });

  it('skips admin pages and immediate repeats', async () => {
    const { requests } = mockApi({ 'POST /analytics/page-views': { status: 204 } });
    reportPageView('/admin');
    reportPageView('/admin/users');
    reportPageView('/report');
    reportPageView('/report');

    await vi.waitFor(() =>
      expect(requests.filter((r) => r.path === '/analytics/page-views')).toHaveLength(1),
    );
    expect(requests.map((r) => (r.body as { path?: string } | undefined)?.path)).not.toContain(
      '/admin/users',
    );
  });

  it('never throws when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    expect(() => reportPageView('/profile')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
