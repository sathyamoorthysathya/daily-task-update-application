import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
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
    expect(card.getByText('#12')).toBeInTheDocument();
    expect(card.getByText('Filed the return.')).toBeInTheDocument();
    expect(card.getByText(/6 Nov 2026|Nov 6, 2026/)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'https://docs.example.com/gst' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(card.getByText('Completed')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Main' })).toBeInTheDocument();

    const updates = within(
      screen.getByRole('heading', { name: 'Task updates' }).closest('section')!,
    );
    expect(updates.getAllByRole('listitem')).toHaveLength(2);
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
    fireEvent.change(form.getByLabelText('Task Name'), { target: { value: 'Prepare GST return' } });
    fireEvent.change(form.getByLabelText('Task Status'), { target: { value: 'On Hold' } });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        /Task #12 was updated. The Excel workbook is being updated in the background./,
      ),
    ).toBeInTheDocument();
    const patches = requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((r) => [r.path, r.body])).toEqual([
      ['/tasks/task-1', { name: 'Prepare GST return', version: 4 }],
      [
        '/tasks/task-1/updates/upd-2',
        {
          description: 'Filed the return.',
          reference: 'https://docs.example.com/gst',
          status: 'ON_HOLD',
          version: 2,
        },
      ],
    ]);
    await waitFor(() => expect(loads).toBe(2));
  });

  it('validates the edit form', async () => {
    const { requests } = renderDetail();
    await details();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit task' }));
    fireEvent.change(form.getByLabelText('Task Name'), { target: { value: '  ' } });
    fireEvent.change(form.getByLabelText('Documentation Link / Reference'), {
      target: { value: 'ftp://x' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));

    expect(await form.findByText('Task name is required')).toBeInTheDocument();
    expect(form.getByText('Links must start with http:// or https://')).toBeInTheDocument();
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
      version: 1,
    });
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
