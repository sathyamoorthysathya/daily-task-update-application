import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { listOf, makeWorkbook, NO_TASK_DETAILS, NO_WORK_DETAILS } from '../../test/fixtures';
import { apiError, clearCookies, type MockHandler, mockApi, TEST_USER } from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { SaveTaskResult, TaskMatch, TaskUpdate } from './task.types';
import { todayLocal } from './tasks.schemas';

const MAIN = makeWorkbook({
  id: 'wb-main',
  name: 'Daily Tasks',
  isDefault: true,
  nextTaskNumber: 4,
});
const APOLLO = makeWorkbook({ id: 'wb-apollo', name: 'Project Apollo', nextTaskNumber: 1 });

const UPDATE: TaskUpdate = {
  id: 'upd-1',
  taskId: 'task-1',
  entryDate: '2026-11-05',
  status: 'IN_PROGRESS',
  description: 'Collected invoices',
  reference: null,
  ...NO_WORK_DETAILS,
  version: 3,
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T09:00:00.000Z',
};

const MATCH: TaskMatch = {
  task: {
    id: 'task-1',
    workbookId: 'wb-main',
    taskNumber: 2,
    name: 'Prepare GST report',
    status: 'IN_PROGRESS',
    lastEntryDate: '2026-11-05',
    entryCount: 1,
    ...NO_TASK_DETAILS,
    version: 1,
    createdAt: '2026-11-05T09:00:00.000Z',
  },
  workbookName: 'Daily Tasks',
  targetUpdate: UPDATE,
  hasUpdateOnDate: false,
};

function saved(overrides: Partial<SaveTaskResult['task']> = {}, update: Partial<TaskUpdate> = {}) {
  return {
    task: { ...MATCH.task, ...overrides },
    update: { ...UPDATE, ...update },
    excelSync: { workbookId: 'wb-main', status: 'queued', jobId: 'job-1' },
  } satisfies SaveTaskResult;
}

function syncStatus(state: string, extra: object = {}) {
  return {
    body: {
      workbookId: 'wb-main',
      state,
      dataVersion: 4,
      syncedVersion: state === 'synced' ? 4 : 3,
      lastSyncedAt: null,
      pendingJobs: state === 'pending' ? 1 : 0,
      retryingJobs: state === 'retrying' ? 1 : 0,
      failedJobs: state === 'failed' ? 1 : 0,
      nextRetryAt: null,
      lastError: null,
      ...extra,
    },
  };
}

function renderForm(routesOverride: Record<string, MockHandler> = {}) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /workbooks': { body: listOf(MAIN, APOLLO) },
    'GET /tasks/recent-updates': { body: { updates: [] } },
    'GET /tasks/lookup': { body: { match: null } },
    'GET /workbooks/wb-main/sync-status': syncStatus('synced'),
    ...routesOverride,
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/tasks/new'] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { ...api, router };
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Picks a time in a 12-hour time field, e.g. fillTime('Start Time', '9', '30', 'AM'). */
function fillTime(label: string, hour: string, minute: string, period: 'AM' | 'PM') {
  fill(`${label} hour`, hour);
  fill(`${label} minute`, minute);
  fill(`${label} AM or PM`, period);
}

async function fillValidTask() {
  await screen.findByRole('form', { name: 'New task' });
  fill('Task Name', 'Prepare GST report');
  fill('Task Description', 'Filed the October return.');
  fill('Documentation Link / Reference', 'https://docs.example.com/gst');
  fill('Task Status', 'Completed');
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
}

describe('NewTaskPage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('workbook selection', () => {
    it('pre-selects the default workbook and shows the next task number and today’s date', async () => {
      renderForm();

      await screen.findByRole('form', { name: 'New task' });
      expect(screen.getByLabelText('Workbook')).toHaveValue('wb-main');
      expect(screen.getByRole('option', { name: /Daily Tasks \(default\)/ })).toBeInTheDocument();
      expect(screen.getByLabelText('Task Number')).toHaveValue('#4');
      expect(screen.getByLabelText('Task Number')).toHaveAttribute('readonly');
      expect(screen.getByLabelText('Task Date')).toHaveValue(todayLocal());
      expect(screen.getByLabelText('Task Status')).toHaveValue('To Do');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(
        expect.arrayContaining(['To Do', 'In Progress', 'Pending', 'Completed', 'On Hold']),
      );
    });

    it('asks the user to choose when several workbooks exist and none is the default', async () => {
      const { requests } = renderForm({
        'GET /workbooks': { body: listOf({ ...MAIN, isDefault: false }, APOLLO) },
      });
      await fillValidTask();

      expect(screen.getByLabelText('Workbook')).toHaveValue('');
      submit();

      expect(await screen.findByText('Choose a workbook')).toBeInTheDocument();
      expect(requests.some((r) => r.method === 'POST')).toBe(false);

      fill('Workbook', 'wb-apollo');
      expect(screen.getByLabelText('Task Number')).toHaveValue('#1');
    });

    it('uses the only workbook without asking', async () => {
      renderForm({ 'GET /workbooks': { body: listOf({ ...MAIN, isDefault: false }) } });

      expect(await screen.findByText('Daily Tasks', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Workbook')).not.toBeInTheDocument();
    });

    it('sends users without a workbook to create one first', async () => {
      const { router } = renderForm({ 'GET /workbooks': { body: listOf() } });

      await screen.findByRole('heading', { name: 'Create your Excel sheet' });
      expect(router.state.location.state).toEqual({ from: '/tasks/new' });
    });
  });

  describe('creating a task', () => {
    it('validates the form before saving', async () => {
      const { requests } = renderForm();
      await screen.findByRole('form', { name: 'New task' });
      fill('Documentation Link / Reference', 'javascript:alert(1)');

      submit();

      expect(await screen.findByText('Task name is required')).toBeInTheDocument();
      expect(screen.getByText('Description is required')).toBeInTheDocument();
      expect(screen.getByText('Links must start with http:// or https://')).toBeInTheDocument();
      expect(requests.some((r) => r.method === 'POST')).toBe(false);
    });

    it('saves the task to the selected workbook and resets the form', async () => {
      let recentCalls = 0;
      const { requests } = renderForm({
        'POST /tasks': { status: 201, body: saved({ taskNumber: 4, status: 'COMPLETED' }) },
        'GET /tasks/recent-updates': () => {
          recentCalls += 1;
          return { body: { updates: [] } };
        },
      });
      await fillValidTask();
      fill('Task Date', '2026-11-06');

      submit();

      // Saved at once; the Excel update follows in the background.
      const notice = await screen.findByText(
        /Task #4 “Prepare GST report” was added to Daily Tasks/,
      );
      expect(notice).toHaveTextContent('Updating the Excel workbook…');
      await waitFor(() => expect(notice).toHaveTextContent('The Excel workbook is up to date.'));
      expect(requests.some((r) => r.path === '/workbooks/wb-main/sync-status')).toBe(true);
      expect(requests.find((r) => r.method === 'POST' && r.path === '/tasks')?.body).toEqual({
        workbookId: 'wb-main',
        name: 'Prepare GST report',
        ...NO_TASK_DETAILS,
        entryDate: '2026-11-06',
        description: 'Filed the October return.',
        reference: 'https://docs.example.com/gst',
        status: 'COMPLETED',
        startTime: null,
        endTime: null,
        remarks: null,
      });
      expect(screen.getByLabelText('Task Name')).toHaveValue('');
      expect(screen.getByLabelText('Task Description')).toHaveValue('');
      expect(screen.getByLabelText('Task Date')).toHaveValue('2026-11-06');
      await waitFor(() => expect(recentCalls).toBeGreaterThanOrEqual(2));
    });

    it('saves who assigned the task, its priority, project, due date, hours and remarks', async () => {
      const { requests } = renderForm({ 'POST /tasks': { status: 201, body: saved() } });
      await fillValidTask();
      fill('Project / Module', '  Billing   module ');
      fill('Assigned By', 'Priya (Team Lead)');
      fill('Priority', 'High');
      fill('Due Date', '2026-11-20');
      fillTime('Start Time', '9', '30', 'AM');
      fillTime('End Time', '1', '15', 'PM');
      fill('Remarks / Blockers', 'Waiting for invoices');
      expect(screen.getByText('Hours worked: 3 h 45 min')).toBeInTheDocument();

      submit();

      await screen.findByText(/was added to Daily Tasks/);
      expect(requests.find((r) => r.method === 'POST' && r.path === '/tasks')?.body).toMatchObject({
        project: 'Billing module',
        assignedBy: 'Priya (Team Lead)',
        priority: 'HIGH',
        dueDate: '2026-11-20',
        startTime: '09:30',
        endTime: '13:15',
        remarks: 'Waiting for invoices',
      });
      // The form is cleared for the next task.
      expect(screen.getByLabelText('Assigned By')).toHaveValue('');
      expect(screen.getByLabelText('Priority')).toHaveValue('');
      expect(screen.getByLabelText('Start Time hour')).toHaveValue('');
    });

    it('uses the 12-hour clock for times and can clear a time', async () => {
      renderForm();
      await fillValidTask();

      // Picking only the hour is enough: it starts as that hour, 00 minutes, AM.
      fill('End Time hour', '12');
      expect(screen.getByLabelText('End Time minute')).toHaveValue('00');
      expect(screen.getByLabelText('End Time AM or PM')).toHaveValue('AM');
      fill('End Time AM or PM', 'PM');
      fillTime('Start Time', '11', '45', 'AM');
      // 11:45 AM to 12:00 PM (noon).
      expect(screen.getByText('Hours worked: 15 min')).toBeInTheDocument();

      fill('End Time hour', '');
      expect(screen.getByLabelText('End Time AM or PM')).toHaveValue('');
      expect(screen.queryByText(/Hours worked:/)).not.toBeInTheDocument();
    });

    it('rejects an end time that is not after the start time', async () => {
      const { requests } = renderForm();
      await fillValidTask();
      fillTime('Start Time', '2', '00', 'PM');
      fillTime('End Time', '9', '00', 'AM');

      submit();

      expect(
        await screen.findByText('The end time must be after the start time'),
      ).toBeInTheDocument();
      expect(requests.some((r) => r.method === 'POST')).toBe(false);
    });

    it('keeps following the Excel update while it is retried', async () => {
      let checks = 0;
      renderForm({
        'POST /tasks': { status: 201, body: saved() },
        'GET /workbooks/wb-main/sync-status': () => {
          checks += 1;
          return syncStatus(checks === 1 ? 'retrying' : 'synced');
        },
      });
      await fillValidTask();
      submit();

      expect(
        await screen.findByText(/will be retried automatically/, {}, { timeout: 2000 }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(/The Excel workbook is up to date/, {}, { timeout: 3000 }),
      ).toBeInTheDocument();
    });

    it('says the task is saved when the Excel update failed for good', async () => {
      renderForm({
        'POST /tasks': { status: 201, body: saved() },
        'GET /workbooks/wb-main/sync-status': syncStatus('failed', {
          lastError: 'ENOSPC: no space left on device',
        }),
      });
      await fillValidTask();
      submit();

      const notice = await screen.findByText(/could not be updated/);
      expect(notice).toHaveTextContent('ENOSPC: no space left on device');
      expect(notice).toHaveTextContent('Your task is saved');
      expect(
        within(notice).getByRole('link', { name: 'resynchronise the workbook' }),
      ).toHaveAttribute('href', '/workbooks');
    });

    it('hints that the name already exists as soon as it is entered', async () => {
      const { requests } = renderForm({ 'GET /tasks/lookup': { body: { match: MATCH } } });
      await screen.findByRole('form', { name: 'New task' });

      fill('Task Name', 'prepare gst report');
      fireEvent.blur(screen.getByLabelText('Task Name'));

      expect(
        await screen.findByText(/A task with this name already exists in this workbook/),
      ).toBeInTheDocument();
      expect(requests.find((r) => r.path === '/tasks/lookup')).toBeDefined();
    });

    it('shows recent entries of the selected workbook', async () => {
      renderForm({
        'GET /tasks/recent-updates': {
          body: {
            updates: [
              { ...UPDATE, workbookId: 'wb-main', taskNumber: 2, taskName: 'Prepare GST report' },
            ],
          },
        },
      });

      const recent = within(
        (await screen.findByRole('heading', { name: 'Recent entries in Daily Tasks' })).closest(
          'section',
        )!,
      );
      expect(await recent.findByText('Prepare GST report')).toBeInTheDocument();
      expect(recent.getByText('#2')).toBeInTheDocument();
      expect(recent.getByText('In Progress')).toBeInTheDocument();
    });
  });

  describe('duplicate task dialog', () => {
    function duplicateResponse(match: TaskMatch = MATCH) {
      return apiError(
        409,
        'TASK_ALREADY_EXISTS',
        'This task already exists. What would you like to do?',
        {
          details: match,
        },
      );
    }

    async function openDialog(routesOverride: Record<string, MockHandler> = {}, match?: TaskMatch) {
      const api = renderForm({ 'POST /tasks': duplicateResponse(match), ...routesOverride });
      await fillValidTask();
      fill('Task Date', '2026-11-06');
      submit();
      const dialog = await screen.findByRole('dialog', {
        name: 'This task already exists. What would you like to do?',
      });
      return { ...api, dialog: within(dialog) };
    }

    it('offers the three options and describes the existing task', async () => {
      const { dialog } = await openDialog();

      expect(dialog.getByText('Prepare GST report')).toBeInTheDocument();
      expect(dialog.getByText('#2')).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: /Update Existing Task/ })).toHaveFocus();
      expect(dialog.getByRole('button', { name: /Create New Daily Task Entry/ })).toBeEnabled();
      expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('"Update Existing Task" edits the matched entry with its version', async () => {
      const { dialog, requests } = await openDialog({
        'PATCH /tasks/task-1/updates/upd-1': {
          body: saved({ status: 'COMPLETED' }, { status: 'COMPLETED', version: 4 }),
        },
      });

      fireEvent.click(dialog.getByRole('button', { name: /Update Existing Task/ }));

      expect(await screen.findByText(/Task #2: the entry from .* was updated/)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        description: 'Filed the October return.',
        reference: 'https://docs.example.com/gst',
        status: 'COMPLETED',
        startTime: null,
        endTime: null,
        remarks: null,
        version: 3,
      });
    });

    it('"Create New Daily Task Entry" adds a dated entry to the original task', async () => {
      const { dialog, requests } = await openDialog({
        'POST /tasks/task-1/updates': {
          status: 201,
          body: saved({ entryCount: 2 }, { id: 'upd-2', entryDate: '2026-11-06' }),
        },
      });

      fireEvent.click(dialog.getByRole('button', { name: /Create New Daily Task Entry/ }));

      expect(await screen.findByText(/Task #2: a new entry for .* was added/)).toBeInTheDocument();
      expect(requests.find((r) => r.path === '/tasks/task-1/updates')?.body).toEqual({
        entryDate: '2026-11-06',
        description: 'Filed the October return.',
        reference: 'https://docs.example.com/gst',
        status: 'COMPLETED',
        startTime: null,
        endTime: null,
        remarks: null,
      });
      expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
    });

    it('Cancel closes the dialog without saving and keeps the form', async () => {
      const { dialog, requests } = await openDialog();

      fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Task Name')).toHaveValue('Prepare GST report');
      expect(requests.filter((r) => r.method !== 'GET').map((r) => r.path)).toEqual(['/tasks']);
    });

    it('closes on Escape', async () => {
      await openDialog();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not offer a second entry for a date that already has one', async () => {
      const { dialog } = await openDialog({}, { ...MATCH, hasUpdateOnDate: true });

      expect(dialog.getByRole('button', { name: /Create New Daily Task Entry/ })).toBeDisabled();
      expect(dialog.getByText(/already has an entry for/)).toBeInTheDocument();
    });

    it('explains a conflict and refreshes the existing task', async () => {
      const { dialog } = await openDialog({
        'PATCH /tasks/task-1/updates/upd-1': apiError(
          409,
          'TASK_UPDATE_VERSION_CONFLICT',
          'This task entry was changed elsewhere. Reload and try again.',
        ),
        'GET /tasks/lookup': {
          body: { match: { ...MATCH, targetUpdate: { ...UPDATE, version: 4 } } },
        },
      });

      fireEvent.click(dialog.getByRole('button', { name: /Update Existing Task/ }));

      expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
