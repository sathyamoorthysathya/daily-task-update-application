import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { listOf, makeWorkbook } from '../../test/fixtures';
import { apiError, clearCookies, type MockHandler, mockApi, TEST_USER } from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import { todayLocal } from '../tasks/tasks.schemas';
import type { TaskSummary } from './dashboard.api';

const MAIN = makeWorkbook({ id: 'wb-main', name: 'Main', isDefault: true, taskCount: 3 });
const SIDE = makeWorkbook({ id: 'wb-side', name: 'Side', taskCount: 1, syncStatus: 'retrying' });

function summary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  const activity = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    entries: i === 13 ? 3 : i % 3,
    completed: i === 13 ? 1 : 0,
  }));
  return {
    today: '2026-11-14',
    totals: { tasks: 4, entries: 9, workbooks: 2, completed: 1, open: 3, completionRate: 25 },
    byStatus: { TO_DO: 1, IN_PROGRESS: 1, PENDING: 1, COMPLETED: 1, ON_HOLD: 0 },
    activity,
    periods: { today: 3, last7Days: 8, previous7Days: 4 },
    workbooks: [
      {
        id: 'wb-main',
        name: 'Main',
        tasks: 3,
        completed: 1,
        byStatus: { TO_DO: 1, IN_PROGRESS: 1, PENDING: 0, COMPLETED: 1, ON_HOLD: 0 },
      },
      {
        id: 'wb-side',
        name: 'Side',
        tasks: 1,
        completed: 0,
        byStatus: { TO_DO: 0, IN_PROGRESS: 0, PENDING: 1, COMPLETED: 0, ON_HOLD: 0 },
      },
    ],
    ...overrides,
  };
}

const RECENT = [
  {
    id: 'upd-1',
    taskId: 'task-7',
    workbookId: 'wb-main',
    taskNumber: 7,
    taskName: 'Prepare GST report',
    entryDate: '2026-11-14',
    status: 'IN_PROGRESS',
    description: 'Collected invoices',
    reference: null,
    version: 1,
    createdAt: '2026-11-14T09:00:00.000Z',
    updatedAt: '2026-11-14T09:00:00.000Z',
  },
];

function renderDashboard(routesOverride: Record<string, MockHandler> = {}) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /workbooks': { body: listOf(MAIN, SIDE) },
    'GET /tasks/summary': { body: summary() },
    'GET /tasks/recent-updates': { body: { updates: RECENT } },
    ...routesOverride,
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/dashboard'] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { ...api, router };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the key figures for the user’s local date', async () => {
    const { requests } = renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const totals = await screen.findByRole('article', { name: 'Total tasks' });
    expect(totals).toHaveTextContent('4');
    expect(totals).toHaveTextContent('9 entries in 2 workbooks');
    expect(screen.getByRole('article', { name: 'Entries this week' })).toHaveTextContent(
      '+100% vs the previous 7 days',
    );
    expect(screen.getByRole('article', { name: 'Completed' })).toHaveTextContent(
      '25% of all tasks',
    );
    expect(screen.getByRole('article', { name: 'Open tasks' })).toHaveTextContent(
      '1 in progress · 1 pending · 0 on hold',
    );
    expect(
      screen.getByText(/You have logged 3 entries today and 8 entries in the last 7 days/),
    ).toBeInTheDocument();

    const request = requests.find((r) => r.path === '/tasks/summary');
    expect(request?.query.get('today')).toBe(todayLocal());
    expect(request?.query.get('days')).toBe('14');
  });

  it('charts the daily activity and the tasks by status', async () => {
    renderDashboard();

    expect(
      await screen.findByRole('img', { name: 'Entries per day: 15 in the last 14 days' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 tasks by status' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Status breakdown' });
    expect(within(legend).getByText('In Progress').closest('li')).toHaveTextContent('1 (25%)');
  });

  it('lists recent updates linking to their task, and workbook progress with Excel status', async () => {
    renderDashboard();

    const link = await screen.findByRole('link', { name: /#7 Prepare GST report/ });
    expect(link).toHaveAttribute('href', '/tasks/task-7');
    const recent = screen.getByRole('table', { name: 'Recent task updates' });
    expect(within(recent).getByText('Main')).toBeInTheDocument();
    expect(within(recent).getByText('In Progress')).toBeInTheDocument();

    expect(
      await screen.findByRole('progressbar', { name: 'Main: 33% of tasks completed' }),
    ).toHaveAttribute('aria-valuenow', '33');
    const workbooks = screen.getByTestId('workbook-summary');
    expect(within(workbooks).getByText('Default')).toBeInTheDocument();
    expect(within(workbooks).getByText('Excel update retrying')).toBeInTheDocument();
    expect(within(workbooks).getByText('Excel up to date')).toBeInTheDocument();
  });

  it('invites a user without tasks to add the first one', async () => {
    renderDashboard({
      'GET /tasks/summary': {
        body: summary({
          totals: { tasks: 0, entries: 0, workbooks: 1, completed: 0, open: 0, completionRate: 0 },
          byStatus: { TO_DO: 0, IN_PROGRESS: 0, PENDING: 0, COMPLETED: 0, ON_HOLD: 0 },
          periods: { today: 0, last7Days: 0, previous7Days: 0 },
        }),
      },
      'GET /tasks/recent-updates': { body: { updates: [] } },
    });

    expect(await screen.findByText(/Add your first task to start tracking/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first task' })).toHaveAttribute(
      'href',
      '/tasks/new',
    );
  });

  it('shows an error with a retry when the figures cannot be loaded', async () => {
    let calls = 0;
    renderDashboard({
      'GET /tasks/summary': () => {
        calls += 1;
        return calls === 1
          ? apiError(500, 'INTERNAL', 'Internal server error')
          : { body: summary() };
      },
    });

    expect(await screen.findByText(/Could not load your dashboard figures/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('article', { name: 'Total tasks' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load your dashboard figures/)).not.toBeInTheDocument();
  });
});

describe('app layout', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has a sidebar with the main sections and highlights the current page', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Tasks', 'Add task', 'Workbooks', 'Profile']);
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveClass('active');
    expect(screen.getByTestId('current-user')).toHaveTextContent('Jane Doe');
  });

  it('searches tasks from the top bar', async () => {
    const { router } = renderDashboard({
      'GET /tasks': { body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    });
    await screen.findByRole('heading', { name: 'Dashboard' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find tasks' }), {
      target: { value: 'gst report' },
    });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toBe('?search=gst+report');
  });

  it('opens and closes the navigation drawer on small screens', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });
    const open = screen.getByRole('button', { name: 'Open menu' });

    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(open).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(open).toHaveAttribute('aria-expanded', 'false');
  });
});
