import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusPanel } from './SystemStatusPanel';

const healthy = {
  status: 'ok',
  info: { database: { status: 'up' } },
  error: {},
  details: { database: { status: 'up' } },
};

const live = { status: 'ok', info: {}, error: {}, details: {} };

const databaseDown = {
  statusCode: 503,
  error: 'Service Unavailable',
  message: 'Service Unavailable Exception',
  details: { status: 'error', error: { database: { status: 'down' } } },
  path: '/api/health',
  method: 'GET',
  timestamp: '2026-01-01T00:00:00.000Z',
};

function respondWith(routes: Record<string, { body: unknown; status?: number }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const route = routes[url];
    if (!route) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.body), { status: route.status ?? 200 }),
    );
  });
}

describe('SystemStatusPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the API and database as operational when both checks pass', async () => {
    respondWith({ '/api/health/live': { body: live }, '/api/health': { body: healthy } });

    render(<SystemStatusPanel />);

    expect(await screen.findByText(/Last checked at/)).toBeInTheDocument();
    expect(screen.getByTestId('status-API server')).toHaveTextContent('Operational');
    expect(screen.getByTestId('status-Database')).toHaveTextContent('Operational');
  });

  it('shows the database as unavailable when the readiness check returns 503', async () => {
    respondWith({
      '/api/health/live': { body: live },
      '/api/health': { body: databaseDown, status: 503 },
    });

    render(<SystemStatusPanel />);

    expect(await screen.findByText(/Last checked at/)).toBeInTheDocument();
    expect(screen.getByTestId('status-API server')).toHaveTextContent('Operational');
    expect(screen.getByTestId('status-Database')).toHaveTextContent('Unavailable');
  });

  it('shows both services as unavailable when the API cannot be reached', async () => {
    respondWith({});

    render(<SystemStatusPanel />);

    expect(await screen.findByText(/Last checked at/)).toBeInTheDocument();
    expect(screen.getByTestId('status-API server')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('status-Database')).toHaveTextContent('Unavailable');
  });

  it('re-runs the checks when Refresh is clicked', async () => {
    const fetchSpy = respondWith({
      '/api/health/live': { body: live },
      '/api/health': { body: healthy },
    });
    render(<SystemStatusPanel />);
    await screen.findByText(/Last checked at/);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByTestId('status-Database')).toHaveTextContent('Checking…');
    await screen.findByText(/Last checked at/);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
