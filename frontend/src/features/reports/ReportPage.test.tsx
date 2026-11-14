import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { listOf, makeWorkbook, NO_TASK_DETAILS, NO_WORK_DETAILS } from '../../test/fixtures';
import {
  apiError,
  clearCookies,
  type MockHandler,
  type MockRequest,
  mockApi,
  TEST_USER,
} from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { ReportEntry, Task, TaskReport } from '../tasks/task.types';
import { todayLocal } from '../tasks/tasks.schemas';

const GST: Task = {
  id: 'task-1',
  workbookId: 'wb-main',
  taskNumber: 1,
  name: 'Prepare GST report',
  status: 'COMPLETED',
  lastEntryDate: '2026-11-06',
  entryCount: 2,
  assignedBy: 'Priya (Team Lead)',
  priority: 'HIGH',
  project: 'Billing module',
  dueDate: '2026-11-20',
  version: 3,
  createdAt: '2026-11-05T09:00:00.000Z',
};

const AUDIT: Task = {
  ...GST,
  ...NO_TASK_DETAILS,
  id: 'task-2',
  taskNumber: 2,
  name: 'Audit preparation',
  status: 'IN_PROGRESS',
  lastEntryDate: '2026-11-06',
  entryCount: 1,
};

function entry(overrides: Partial<ReportEntry>): ReportEntry {
  return {
    id: 'upd-1',
    taskId: GST.id,
    entryDate: '2026-11-05',
    status: 'IN_PROGRESS',
    description: 'Collected invoices',
    reference: null,
    ...NO_WORK_DETAILS,
    version: 1,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z',
    task: GST,
    workbookName: 'Main',
    ...overrides,
  };
}

const REPORT: TaskReport = {
  from: '2026-11-01',
  to: '2026-11-30',
  totals: {
    entries: 3,
    tasks: 2,
    completedTasks: 1,
    daysWorked: 2,
    minutesWorked: 285,
    entriesWithoutTime: 1,
  },
  entries: [
    entry({
      startTime: '09:30',
      endTime: '13:15',
      minutesWorked: 225,
      remarks: 'Waiting for the October invoices',
    }),
    entry({
      id: 'upd-2',
      entryDate: '2026-11-06',
      status: 'COMPLETED',
      description: 'Filed the return',
      reference: 'INV-204',
      startTime: '10:00',
      endTime: '11:00',
      minutesWorked: 60,
    }),
    entry({
      id: 'upd-3',
      taskId: AUDIT.id,
      task: AUDIT,
      entryDate: '2026-11-06',
      description: 'Listed the open points',
    }),
  ],
  truncated: false,
};

const EMPTY: TaskReport = {
  from: null,
  to: null,
  totals: {
    entries: 0,
    tasks: 0,
    completedTasks: 0,
    daysWorked: 0,
    minutesWorked: 0,
    entriesWithoutTime: 0,
  },
  entries: [],
  truncated: false,
};

function renderAt(path: string, routesOverride: Record<string, MockHandler> = {}) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /workbooks': { body: listOf(makeWorkbook({ id: 'wb-main', name: 'Main' })) },
    'GET /tasks/report': { body: REPORT },
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

const reportQuery = (requests: MockRequest[]) =>
  requests.filter((r) => r.path === '/tasks/report').at(-1)?.query;

const total = (label: string) => screen.findByRole('article', { name: label });

describe('ReportPage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the current month by default, with totals', async () => {
    const { requests } = renderAt('/report');

    expect(await total('Tasks worked on')).toHaveTextContent('2');
    expect(await total('Tasks completed')).toHaveTextContent('50% of the tasks');
    expect(await total('Daily entries')).toHaveTextContent('3');
    expect(await total('Days worked')).toHaveTextContent('2');
    const hours = await total('Hours recorded');
    expect(hours).toHaveTextContent('4 h 45 min');
    expect(hours).toHaveTextContent('1 entry without times');

    const today = todayLocal();
    expect(reportQuery(requests)?.get('from')).toBe(`${today.slice(0, 8)}01`);
    expect(reportQuery(requests)?.get('to')?.slice(0, 8)).toBe(today.slice(0, 8));
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lists each task once with who assigned it, priority, due date and hours', async () => {
    renderAt('/report');

    const tasks = within(await screen.findByRole('table', { name: 'Tasks' }));
    const rows = tasks.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const gst = within(rows[0]!);
    expect(gst.getByRole('link', { name: '#1 Prepare GST report' })).toHaveAttribute(
      'href',
      '/tasks/task-1',
    );
    expect(gst.getByText('Billing module')).toBeInTheDocument();
    expect(gst.getByText('Priya (Team Lead)')).toBeInTheDocument();
    expect(gst.getByText('High')).toHaveClass('priority--high');
    expect(gst.getByText('2 days')).toBeInTheDocument();
    expect(gst.getByText('4 h 45 min')).toBeInTheDocument();
    expect(gst.getByText('Completed')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('1 day')).toBeInTheDocument();
  });

  it('shows the daily work log grouped by day, with remarks and references', async () => {
    renderAt('/report');

    const log = within(await screen.findByRole('table', { name: 'Daily work log' }));
    const days = log.getAllByRole('columnheader').filter((cell) => cell.closest('.report-day'));
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveTextContent('1 entry · 3 h 45 min');
    expect(days[1]).toHaveTextContent('2 entries · 1 h');
    expect(log.getByText('Collected invoices')).toBeInTheDocument();
    expect(log.getByText('Waiting for the October invoices')).toBeInTheDocument();
    expect(log.getByText('Ref: INV-204')).toBeInTheDocument();
    expect(log.getByText('Listed the open points')).toBeInTheDocument();
  });

  it('switches to the overall report and to custom dates', async () => {
    const { requests, router } = renderAt('/report');
    await total('Tasks worked on');

    fireEvent.click(screen.getByRole('button', { name: 'Overall' }));
    await waitFor(() => expect(reportQuery(requests)?.has('from')).toBe(false));
    expect(reportQuery(requests)?.has('to')).toBe(false);
    expect(await screen.findByText('All work to date')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?period=overall');

    fireEvent.click(screen.getByRole('button', { name: 'Custom dates' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-15' } });
    await waitFor(() => expect(reportQuery(requests)?.get('to')).toBe('2026-10-15'));
    expect(reportQuery(requests)?.get('from')).toBe('2026-10-01');
  });

  it('rejects custom dates that end before they start, without querying', async () => {
    const { requests } = renderAt('/report?period=custom&from=2026-11-10&to=2026-11-01');

    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.path === '/tasks/report')).toBe(false);
  });

  it('shows an empty state when nothing was recorded', async () => {
    renderAt('/report?period=overall', { 'GET /tasks/report': { body: EMPTY } });

    expect(
      await screen.findByRole('heading', { name: 'No work recorded in this period' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a task' })).toHaveAttribute('href', '/tasks/new');
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Download Excel/ })).toBeDisabled();
  });

  it('downloads the report of the chosen period as an Excel file', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { requests } = renderAt('/report?period=overall', {
      'GET /tasks/report/download': {
        raw: new Response(new Blob(['xlsx']), {
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="Work report - all work.xlsx"',
          },
        }),
      },
    });
    await total('Tasks worked on');

    fireEvent.click(screen.getByRole('button', { name: /Download Excel/ }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const download = requests.find((r) => r.path === '/tasks/report/download');
    expect(download?.query.toString()).toBe('format=xlsx');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows an error when the download fails', async () => {
    renderAt('/report', {
      'GET /tasks/report/download': apiError(500, 'INTERNAL', 'boom'),
    });
    await total('Tasks worked on');

    fireEvent.click(screen.getByRole('button', { name: /Download Excel/ }));

    expect(await screen.findByText(/Could not download the report/)).toBeInTheDocument();
  });

  it('downloads the report as a PDF for the chosen period', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { requests } = renderAt('/report?period=custom&from=2026-10-01&to=2026-10-31', {
      'GET /tasks/report/download': {
        raw: new Response(new Blob(['%PDF-']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="Work report.pdf"' },
        }),
      },
    });
    await total('Tasks worked on');

    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const download = requests.find((r) => r.path === '/tasks/report/download');
    expect(Object.fromEntries(download!.query)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      format: 'pdf',
    });
  });

  it('shows an error and retries', async () => {
    let calls = 0;
    renderAt('/report', {
      'GET /tasks/report': () => {
        calls += 1;
        return calls === 1 ? apiError(500, 'INTERNAL', 'boom') : { body: REPORT };
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await total('Tasks worked on')).toHaveTextContent('2');
  });
});
