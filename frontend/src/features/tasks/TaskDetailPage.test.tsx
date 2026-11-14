import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { NO_TASK_DETAILS, NO_WORK_DETAILS } from '../../test/fixtures';
import { apiError, clearCookies, type MockHandler, mockApi, TEST_USER } from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { TaskDetail } from './task.types';

const TASK: TaskDetail = {
  id: 'task-1',
  workbookId: 'wb-main',
  taskNumber: 12,
  name: 'Prepare GST report',
  status: 'COMPLETED',
  lastEntryDate: '2026-11-06',
  entryCount: 2,
  ...NO_TASK_DETAILS,
  version: 4,
  createdAt: '2026-11-05T09:00:00.000Z',
  workbook: { id: 'wb-main', name: 'Main' },
  updates: [
    {
      id: 'upd-2',
      taskId: 'task-1',
      entryDate: '2026-11-06',
      status: 'COMPLETED',
      description: 'Filed the return.',
      reference: 'https://docs.example.com/gst',
      ...NO_WORK_DETAILS,
      version: 2,
      createdAt: '2026-11-06T09:00:00.000Z',
      updatedAt: '2026-11-06T10:00:00.000Z',
    },
    {
      id: 'upd-1',
      taskId: 'task-1',
      entryDate: '2026-11-05',
      status: 'IN_PROGRESS',
      description: 'Collected invoices.',
      reference: null,
      ...NO_WORK_DETAILS,
      version: 1,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T09:00:00.000Z',
    },
  ],
  history: [
    {
      id: 'h1',
      action: 'TASK_CREATED',
      taskUpdateId: 'upd-1',
      changes: { entryDate: '2026-11-05', status: 'IN_PROGRESS' },
      createdAt: '2026-11-05T09:00:00.000Z',
    },
    {
      id: 'h2',
      action: 'ENTRY_ADDED',
      taskUpdateId: 'upd-2',
      changes: { entryDate: '2026-11-06', status: 'IN_PROGRESS' },
      createdAt: '2026-11-06T09:00:00.000Z',
    },
    {
      id: 'h3',
      action: 'ENTRY_UPDATED',
      taskUpdateId: 'upd-2',
      changes: {
        entryDate: '2026-11-06',
        status: { from: 'IN_PROGRESS', to: 'COMPLETED' },
        description: { from: 'x', to: 'Filed the return.' },
      },
      createdAt: '2026-11-06T10:00:00.000Z',
    },
    {
      id: 'h4',
      action: 'TASK_RENAMED',
      taskUpdateId: null,
      changes: { name: { from: 'GST report', to: 'Prepare GST report' } },
      createdAt: '2026-11-06T11:00:00.000Z',
    },
  ],
};

const SYNCED = { workbookId: 'wb-main', status: 'queued', jobId: 'job-1' };

function renderDetail(routesOverride: Record<string, MockHandler> = {}) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /tasks/task-1': { body: TASK },
    'GET /tasks': { body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 } },
    'GET /workbooks': { body: { workbooks: [], defaultWorkbookId: null, limit: 20 } },
    ...routesOverride,
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/tasks/task-1'] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { ...api, router };
}

const details = async () =>
  within((await screen.findByRole('heading', { name: 'Details' })).closest('section')!);

describe('TaskDetailPage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the task details and its dated updates', async () => {
    renderDetail();

    const card = await details();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Prepare GST report' }),
    ).toBeInTheDocument();
    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(breadcrumb.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    expect(breadcrumb.getByText('#12')).toBeInTheDocument();
    expect(card.getByText(/6 Nov 2026|Nov 6, 2026/)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Main' })).toBeInTheDocument();

    const updates = within(
      screen.getByRole('heading', { name: 'Daily entries' }).closest('section')!,
    );
    expect(updates.getAllByRole('listitem')).toHaveLength(2);
    expect(updates.getByText('Filed the return.')).toBeInTheDocument();
    expect(updates.getByText('Completed')).toBeInTheDocument();
    expect(updates.getByText('Latest')).toBeInTheDocument();
    expect(updates.getByRole('link', { name: 'https://docs.example.com/gst' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(updates.getByText('Collected invoices.')).toBeInTheDocument();
  });

  it('shows the history on request', async () => {
    renderDetail();
    await details();
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View history' }));

    const history = within(screen.getByRole('heading', { name: 'History' }).closest('section')!);
    expect(history.getByText('Task renamed')).toBeInTheDocument();
    expect(history.getByText('“GST report” → “Prepare GST report”')).toBeInTheDocument();
    expect(history.getByText('Status: In Progress → Completed')).toBeInTheDocument();
    expect(history.getByText(/Task created for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide history' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a not-found state', async () => {
    renderDetail({ 'GET /tasks/task-1': apiError(404, 'TASK_NOT_FOUND', 'Task not found.') });

    expect(await screen.findByRole('heading', { name: 'Task not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tasks' })).toHaveAttribute('href', '/tasks');
  });

  it('edits the name and the latest entry, then reloads', async () => {
    let loads = 0;
    const { requests } = renderDetail({
      'GET /tasks/task-1': () => {
        loads += 1;
        return { body: TASK };
      },
      'PATCH /tasks/task-1': { body: { task: { ...TASK, version: 5 }, excelSync: SYNCED } },
      'PATCH /tasks/task-1/updates/upd-2': {
        body: { task: TASK, update: TASK.updates[0], excelSync: SYNCED },
      },
    });
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit task' }));
    // The form edits what the Details card shows, nothing from the daily entries.
    expect(form.queryByLabelText('Task Status')).not.toBeInTheDocument();
    expect(form.queryByLabelText('Task Description')).not.toBeInTheDocument();
    fireEvent.change(form.getByLabelText('Task Name'), { target: { value: 'Prepare GST return' } });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        /Task #12 was updated. The Excel workbook is being updated in the background./,
      ),
    ).toBeInTheDocument();
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((r) => [r.path, r.body])).toEqual([
      ['/tasks/task-1', { name: 'Prepare GST return', version: 4 }],
    ]);
    await waitFor(() => expect(loads).toBe(2));
  });

  it('validates the edit form', async () => {
    const { requests } = renderDetail();
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit task' }));
    fireEvent.change(form.getByLabelText('Task Name'), { target: { value: '  ' } });
    fireEvent.change(form.getByLabelText('Assigned By'), { target: { value: 'x'.repeat(101) } });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));

    expect(await form.findByText('Task name is required')).toBeInTheDocument();
    expect(form.getByText('Assigned by must be at most 100 characters')).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('edits an older entry with its version', async () => {
    const { requests } = renderDetail({
      'PATCH /tasks/task-1/updates/upd-1': {
        body: { task: TASK, update: TASK.updates[1], excelSync: SYNCED },
      },
    });
    await details();

    // Second entry in the list = the older one (5 Nov).
    fireEvent.click(screen.getAllByRole('button', { name: /Edit entry from/ })[1]!);
    const form = within(screen.getByRole('form', { name: /Edit entry from/ }));
    fireEvent.change(form.getByLabelText('Description'), {
      target: { value: 'Collected all invoices.' },
    });
    const pick = (label: string, value: string) =>
      fireEvent.change(form.getByLabelText(label), { target: { value } });
    pick('Start time hour', '10');
    pick('End time hour', '12');
    pick('End time minute', '30');
    pick('End time AM or PM', 'PM');
    fireEvent.click(form.getByRole('button', { name: 'Save entry' }));

    expect(
      await screen.findByText(
        /was updated. The Excel workbook is being updated in the background./,
      ),
    ).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      description: 'Collected all invoices.',
      reference: null,
      status: 'IN_PROGRESS',
      startTime: '10:00',
      endTime: '12:30',
      remarks: null,
      version: 1,
    });
  });

  it('shows the task details and the working hours of each entry', async () => {
    renderDetail({
      'GET /tasks/task-1': {
        body: {
          ...TASK,
          assignedBy: 'Priya (Team Lead)',
          priority: 'HIGH',
          project: 'Billing module',
          dueDate: '2026-11-20',
          updates: [
            {
              ...TASK.updates[0],
              startTime: '09:30',
              endTime: '13:15',
              minutesWorked: 225,
              remarks: 'Waiting for invoices',
            },
            TASK.updates[1],
          ],
        },
      },
    });
    await details();

    const section = within(screen.getByRole('region', { name: 'Details' }));
    expect(section.getByText('Priya (Team Lead)')).toBeInTheDocument();
    expect(section.getByText('Billing module')).toBeInTheDocument();
    expect(section.getByText('High')).toBeInTheDocument();
    expect(section.getByText('3 h 45 min')).toBeInTheDocument();
    expect(screen.getByText('High priority')).toHaveClass('priority--high');

    const updates = within(screen.getByRole('region', { name: 'Daily entries' }));
    const first = within(updates.getAllByRole('listitem')[0]!);
    expect(first.getByText('Hours worked').nextElementSibling).toHaveTextContent('3 h 45 min');
    expect(first.getByText('Start time').nextElementSibling).not.toHaveTextContent('—');
    // Fields without a value are still listed, so it is clear what can be filled in.
    const second = within(updates.getAllByRole('listitem')[1]!);
    expect(second.getByText('Remarks / blockers').nextElementSibling).toHaveTextContent('—');
    expect(second.getByText('Work done').nextElementSibling).toHaveTextContent(
      'Collected invoices.',
    );
    expect(updates.getByText('Waiting for invoices')).toBeInTheDocument();
  });

  it('flags a task that is past its due date and not completed', async () => {
    renderDetail({
      'GET /tasks/task-1': { body: { ...TASK, status: 'IN_PROGRESS', dueDate: '2020-01-10' } },
    });

    expect((await details()).getByText('Overdue')).toBeInTheDocument();
  });

  it('sends only the task details that changed', async () => {
    const { requests } = renderDetail({
      'PATCH /tasks/task-1': { body: { task: TASK, excelSync: SYNCED } },
      'PATCH /tasks/task-1/updates/upd-2': {
        body: { task: TASK, update: TASK.updates[0], excelSync: SYNCED },
      },
    });
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit task' }));
    fireEvent.change(form.getByLabelText('Assigned By'), { target: { value: 'Priya' } });
    fireEvent.change(form.getByLabelText('Priority'), { target: { value: 'Medium' } });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));

    await screen.findByText(/Task #12 was updated/);
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((r) => [r.path, r.body])).toEqual([
      [
        '/tasks/task-1',
        { name: 'Prepare GST report', assignedBy: 'Priya', priority: 'MEDIUM', version: 4 },
      ],
    ]);
  });

  it('deletes after confirmation and returns to the list', async () => {
    const { requests, router } = renderDetail({
      'DELETE /tasks/task-1': { body: { taskId: 'task-1', excelSync: SYNCED } },
    });
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete task #12?' }));
    expect(
      dialog.getByText(/will be removed from your task list and from the Excel workbook/),
    ).toBeInTheDocument();
    expect(dialog.getByText(/audit history is kept/)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.click(dialog.getByRole('button', { name: 'Delete task' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(
      await screen.findByText(/Task #12 “Prepare GST report” was deleted/),
    ).toBeInTheDocument();
    const deletion = requests.find((r) => r.method === 'DELETE');
    expect(deletion?.query.get('version')).toBe('4');
    expect(deletion?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const { requests } = renderDetail();
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('explains a conflict when the task changed elsewhere and reloads it', async () => {
    let loads = 0;
    renderDetail({
      'GET /tasks/task-1': () => {
        loads += 1;
        return { body: TASK };
      },
      'DELETE /tasks/task-1': apiError(409, 'TASK_VERSION_CONFLICT', 'Changed elsewhere'),
    });
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));

    expect(
      await screen.findByText(/changed elsewhere. The latest version is shown/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(loads).toBe(2));
  });
});
