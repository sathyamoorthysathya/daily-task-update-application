import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { listOf, makeWorkbook } from '../../test/fixtures';
import {
  apiError,
  clearCookies,
  type MockHandler,
  type MockRequest,
  mockApi,
  TEST_USER,
} from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { TaskListItem, TaskPage } from './task.types';

const MAIN = makeWorkbook({ id: 'wb-main', name: 'Main', isDefault: true });
const APOLLO = makeWorkbook({ id: 'wb-apollo', name: 'Apollo' });

function item(overrides: Partial<TaskListItem>): TaskListItem {
  return {
    id: 'task-1',
    workbookId: 'wb-main',
    taskNumber: 1,
    name: 'Prepare GST report',
    status: 'IN_PROGRESS',
    lastEntryDate: '2026-11-05',
    entryCount: 1,
    version: 1,
    createdAt: '2026-11-05T09:00:00.000Z',
    workbook: { id: 'wb-main', name: 'Main' },
    latestDescription: 'Collected invoices',
    latestReference: null,
    ...overrides,
  };
}

function page(items: TaskListItem[], overrides: Partial<TaskPage> = {}): TaskPage {
  return { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...overrides };
}

const TWO = page([
  item({}),
  item({
    id: 'task-2',
    taskNumber: 4,
    name: 'Apollo kickoff',
    status: 'COMPLETED',
    lastEntryDate: '2026-11-01',
    entryCount: 3,
    workbook: { id: 'wb-apollo', name: 'Apollo' },
    latestDescription: 'Meeting notes shared',
  }),
]);

function renderAt(path: string, routesOverride: Record<string, MockHandler>) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /workbooks': { body: listOf(MAIN, APOLLO) },
    ...routesOverride,
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { ...api, router };
}

const listRequests = (requests: MockRequest[]) =>
  requests.filter((r) => r.method === 'GET' && r.path === '/tasks');
const lastListQuery = (requests: MockRequest[]) => listRequests(requests).at(-1)?.query;

async function table() {
  return within(await screen.findByRole('table'));
}

describe('TasksPage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists tasks with number, workbook, latest date, entries and status badges', async () => {
    renderAt('/tasks', { 'GET /tasks': { body: TWO } });

    const rows = (await table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText('#1')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Prepare GST report' })).toHaveAttribute(
      'href',
      '/tasks/task-1',
    );
    expect(first.getByText('Collected invoices')).toBeInTheDocument();
    expect(first.getByText('Main')).toBeInTheDocument();
    expect(first.getByText('In Progress')).toHaveClass('task-status--in_progress');
    expect(within(rows[1]!).getByText('Completed')).toHaveClass('task-status--completed');
    expect(screen.getByText('Showing 1–2 of 2 tasks')).toBeInTheDocument();
  });

  it('shows a loading state, then the results', async () => {
    renderAt('/tasks', { 'GET /tasks': { body: TWO } });

    expect(await screen.findByText('Loading tasks…')).toBeInTheDocument();
    await table();
    expect(screen.queryByText('Loading tasks…')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no tasks', async () => {
    renderAt('/tasks', { 'GET /tasks': { body: page([]) } });

    expect(await screen.findByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first task' })).toHaveAttribute(
      'href',
      '/tasks/new',
    );
  });

  it('shows a "no matches" state for filters and clears them', async () => {
    const { requests, router } = renderAt('/tasks?status=ON_HOLD&search=zzz', {
      'GET /tasks': (req) => ({ body: req.query.has('status') ? page([]) : TWO }),
    });

    expect(
      await screen.findByRole('heading', { name: 'No tasks match your filters' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);

    await table();
    expect(router.state.location.search).toBe('');
    expect(lastListQuery(requests)?.has('status')).toBe(false);
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });

  it('shows an error state and retries', async () => {
    let calls = 0;
    renderAt('/tasks', {
      'GET /tasks': () => {
        calls += 1;
        return calls === 1 ? apiError(500, 'INTERNAL', 'boom') : { body: TWO };
      },
    });

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await table();
  });

  it('searches by name or number after the user stops typing', async () => {
    const { requests } = renderAt('/tasks', { 'GET /tasks': { body: TWO } });
    await table();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '#4' } });

    await waitFor(() => expect(lastListQuery(requests)?.get('search')).toBe('#4'), {
      timeout: 2000,
    });
    expect(listRequests(requests).filter((r) => r.query.has('search'))).toHaveLength(1);
  });

  it('filters by status, workbook and date range, returning to page 1', async () => {
    const { requests, router } = renderAt('/tasks?page=3', {
      'GET /tasks': { body: page(TWO.items, { page: 3, total: 50, totalPages: 3 }) },
    });
    await table();
    expect(lastListQuery(requests)?.get('page')).toBe('3');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'COMPLETED' } });
    fireEvent.change(screen.getByLabelText('Workbook'), { target: { value: 'wb-apollo' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } });

    await waitFor(() => expect(lastListQuery(requests)?.get('to')).toBe('2026-11-30'));
    const query = lastListQuery(requests)!;
    expect(Object.fromEntries(query)).toEqual({
      status: 'COMPLETED',
      workbookId: 'wb-apollo',
      from: '2026-11-01',
      to: '2026-11-30',
      sort: 'latest',
      page: '1',
      pageSize: '20',
    });
    expect(router.state.location.search).not.toContain('page=');
  });

  it('rejects a date range that ends before it starts, without querying', async () => {
    const { requests } = renderAt('/tasks', { 'GET /tasks': { body: TWO } });
    await table();
    const before = listRequests(requests).length;

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });
    await waitFor(() => expect(listRequests(requests).length).toBe(before + 1));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });

    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(listRequests(requests).length).toBe(before + 1);
  });

  it('sorts by latest date by default and can change the order', async () => {
    const { requests } = renderAt('/tasks', { 'GET /tasks': { body: TWO } });
    await table();
    expect(lastListQuery(requests)?.get('sort')).toBe('latest');

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'number' } });

    await waitFor(() => expect(lastListQuery(requests)?.get('sort')).toBe('number'));
  });

  it('paginates and changes the page size', async () => {
    const { requests } = renderAt('/tasks', {
      'GET /tasks': (req) => ({
        body: page(TWO.items, {
          page: Number(req.query.get('page')),
          pageSize: Number(req.query.get('pageSize')),
          total: 45,
          totalPages: Math.ceil(45 / Number(req.query.get('pageSize'))),
        }),
      }),
    });
    await table();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastListQuery(requests)?.get('page')).toBe('2'));
    expect(await screen.findByText('Showing 21–40 of 45 tasks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    await waitFor(() => expect(lastListQuery(requests)?.get('page')).toBe('3'));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Per page'), { target: { value: '50' } });
    await waitFor(() => expect(lastListQuery(requests)?.get('pageSize')).toBe('50'));
    expect(lastListQuery(requests)?.get('page')).toBe('1');
  });

  it('opens the task details when a row is clicked', async () => {
    const { router } = renderAt('/tasks', {
      'GET /tasks': { body: TWO },
      'GET /tasks/task-2': apiError(404, 'TASK_NOT_FOUND', 'Task not found.'),
    });

    fireEvent.click((await table()).getByText('Meeting notes shared'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks/task-2'));
  });

  it('restores filters from the URL', async () => {
    const { requests } = renderAt('/tasks?status=PENDING&workbookId=wb-main&search=gst', {
      'GET /tasks': { body: TWO },
    });
    await table();

    expect(screen.getByLabelText('Status')).toHaveValue('PENDING');
    expect(screen.getByLabelText('Search')).toHaveValue('gst');
    await waitFor(() => expect(screen.getByLabelText('Workbook')).toHaveValue('wb-main'));
    expect(Object.fromEntries(lastListQuery(requests)!)).toMatchObject({
      status: 'PENDING',
      workbookId: 'wb-main',
      search: 'gst',
    });
  });
});
