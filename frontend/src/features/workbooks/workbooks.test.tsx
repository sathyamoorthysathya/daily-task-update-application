import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { apiError, clearCookies, type MockHandler, mockApi, TEST_USER } from '../../test/mock-api';
import { listOf, makeWorkbook } from '../../test/fixtures';
import { AuthProvider } from '../auth/AuthProvider';
import { SYNC_REFRESH_MS } from './pages/WorkbooksPage';

const FIRST = makeWorkbook({ id: 'wb-1', name: 'Daily Tasks', isDefault: true, taskCount: 12 });
const SECOND = makeWorkbook({
  id: 'wb-2',
  name: 'Project Apollo',
  taskCount: 1,
  createdAt: '2026-02-10T09:00:00.000Z',
});

function renderAt(path: string, routesOverride: Record<string, MockHandler>) {
  const api = mockApi({
    'GET /auth/me': { body: TEST_USER },
    'GET /auth/providers': { body: { google: { enabled: false } } },
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

function card(name: string) {
  return within(screen.getByRole('listitem', { name }));
}

describe('workbooks', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('first-time workflow', () => {
    it('sends users without a workbook from the dashboard to "Create Excel Sheet"', async () => {
      const { router } = renderAt('/dashboard', { 'GET /workbooks': { body: listOf() } });

      expect(
        await screen.findByRole('heading', { name: 'Create your Excel sheet' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/workbooks/new');
      // The sheet's columns are previewed.
      const preview = within(screen.getByRole('table', { name: 'Daily Tasks columns' }));
      expect(preview.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
        'ATask Number',
        'BDate',
        'CTask Name',
        'DTask Description',
        'EDocumentation Link / Reference',
        'FStatus',
      ]);
    });

    it('asks for a name, creates the workbook and returns to the dashboard', async () => {
      let created = false;
      const { requests, router } = renderAt('/workbooks/new', {
        'GET /workbooks': () => ({ body: created ? listOf(FIRST) : listOf() }),
        'POST /workbooks': () => {
          created = true;
          return { status: 201, body: FIRST };
        },
      });
      await screen.findByRole('heading', { name: 'Create your Excel sheet' });
      expect(screen.queryByLabelText(/Use as my default/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Workbook name'), {
        target: { value: '  Daily   Tasks ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create Excel sheet' }));

      expect(
        await screen.findByText(/Your Excel workbook “Daily Tasks” is ready/),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/dashboard');
      expect(requests.find((r) => r.method === 'POST' && r.path === '/workbooks')?.body).toEqual({
        name: 'Daily Tasks',
      });
    });

    it('validates the workbook name', async () => {
      const { requests } = renderAt('/workbooks/new', { 'GET /workbooks': { body: listOf() } });
      await screen.findByRole('heading', { name: 'Create your Excel sheet' });

      fireEvent.click(screen.getByRole('button', { name: 'Create Excel sheet' }));
      expect(await screen.findByText('Workbook name is required')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Workbook name'), { target: { value: 'tasks/2026' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Excel sheet' }));
      expect(await screen.findByText(/Workbook name cannot contain/)).toBeInTheDocument();
      expect(requests.some((r) => r.method === 'POST')).toBe(false);
    });

    it('shows a duplicate-name error from the server', async () => {
      renderAt('/workbooks/new', {
        'GET /workbooks': { body: listOf(FIRST) },
        'POST /workbooks': apiError(409, 'WORKBOOK_NAME_TAKEN', 'Name taken', {
          errors: [{ field: 'name', message: 'You already have a workbook with this name.' }],
        }),
      });
      await screen.findByRole('heading', { name: 'Create a new workbook' });

      fireEvent.change(screen.getByLabelText('Workbook name'), {
        target: { value: 'daily tasks' },
      });
      fireEvent.click(screen.getByLabelText(/Use as my default/));
      fireEvent.click(screen.getByRole('button', { name: 'Create Excel sheet' }));

      expect(
        await screen.findByText('You already have a workbook with this name.'),
      ).toBeInTheDocument();
    });
  });

  describe('workbook list', () => {
    it('shows each workbook’s name, creation date and task count', async () => {
      renderAt('/workbooks', { 'GET /workbooks': { body: listOf(FIRST, SECOND) } });

      await screen.findByRole('listitem', { name: 'Daily Tasks' });
      const first = card('Daily Tasks');
      expect(first.getByText('Default')).toBeInTheDocument();
      expect(first.getByText(/12 tasks/)).toHaveTextContent(
        `Created ${new Date(FIRST.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · 12 tasks · 6 KB`,
      );
      expect(card('Project Apollo').getByText(/1 task ·/)).toBeInTheDocument();
      expect(first.queryByRole('button', { name: 'Set as default' })).not.toBeInTheDocument();
    });

    it('renames with the current version', async () => {
      const { requests } = renderAt('/workbooks', {
        'GET /workbooks': { body: listOf(FIRST, SECOND) },
        'PATCH /workbooks/wb-2': { body: { ...SECOND, name: 'Apollo', version: 2 } },
      });
      await screen.findByRole('listitem', { name: 'Project Apollo' });

      fireEvent.click(card('Project Apollo').getByRole('button', { name: 'Rename' }));
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Apollo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

      await waitFor(() =>
        expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
          name: 'Apollo',
          version: 1,
        }),
      );
    });

    it('explains a version conflict and reloads the list', async () => {
      let listCalls = 0;
      renderAt('/workbooks', {
        'GET /workbooks': () => {
          listCalls += 1;
          return { body: listOf(FIRST, SECOND) };
        },
        'PATCH /workbooks/wb-2': apiError(409, 'WORKBOOK_VERSION_CONFLICT', 'Changed elsewhere'),
      });
      await screen.findByRole('listitem', { name: 'Project Apollo' });

      fireEvent.click(card('Project Apollo').getByRole('button', { name: 'Rename' }));
      fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Apollo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

      expect(await screen.findByText(/changed in another window/)).toBeInTheDocument();
      await waitFor(() => expect(listCalls).toBe(2));
    });

    it('sets the default workbook', async () => {
      const { requests } = renderAt('/workbooks', {
        'GET /workbooks': { body: listOf(FIRST, SECOND) },
        'POST /workbooks/wb-2/default': {
          body: listOf({ ...FIRST, isDefault: false }, { ...SECOND, isDefault: true }),
        },
      });
      await screen.findByRole('listitem', { name: 'Project Apollo' });

      fireEvent.click(card('Project Apollo').getByRole('button', { name: 'Set as default' }));

      expect(await card('Project Apollo').findByText('Default')).toBeInTheDocument();
      expect(
        requests.some((r) => r.method === 'POST' && r.path === '/workbooks/wb-2/default'),
      ).toBe(true);
    });

    it('deletes only after the name is typed, sending the version', async () => {
      let deleted = false;
      const { requests } = renderAt('/workbooks', {
        'GET /workbooks': () => ({ body: deleted ? listOf(FIRST) : listOf(FIRST, SECOND) }),
        'DELETE /workbooks/wb-2': () => {
          deleted = true;
          return { status: 204 };
        },
      });
      await screen.findByRole('listitem', { name: 'Project Apollo' });

      fireEvent.click(card('Project Apollo').getByRole('button', { name: 'Delete' }));
      const confirm = screen.getByRole('button', { name: 'Delete workbook' });
      expect(confirm).toBeDisabled();
      expect(screen.getByText(/1 task will be permanently deleted/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Type “Project Apollo” to confirm'), {
        target: { value: 'Project Apollo' },
      });
      fireEvent.click(confirm);

      await waitFor(() =>
        expect(screen.queryByRole('listitem', { name: 'Project Apollo' })).not.toBeInTheDocument(),
      );
      const del = requests.find((r) => r.method === 'DELETE');
      expect(del?.path).toBe('/workbooks/wb-2');
      expect(del?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
    });

    it('follows a background Excel update until the workbook is synced', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let listCalls = 0;
      renderAt('/workbooks', {
        'GET /workbooks': () => {
          listCalls += 1;
          return { body: listOf({ ...FIRST, syncStatus: listCalls > 1 ? 'synced' : 'pending' }) };
        },
      });
      await screen.findByRole('listitem', { name: 'Daily Tasks' });
      expect(card('Daily Tasks').getByText('Updating Excel…')).toBeInTheDocument();
      // Nothing to do for the user while the update is merely queued.
      expect(card('Daily Tasks').queryByRole('button', { name: 'Resync now' })).toBeNull();

      await vi.advanceTimersByTimeAsync(SYNC_REFRESH_MS);

      await waitFor(() =>
        expect(card('Daily Tasks').queryByText('Updating Excel…')).not.toBeInTheDocument(),
      );
      expect(listCalls).toBe(2);
      // Synced: no more refreshes.
      await vi.advanceTimersByTimeAsync(SYNC_REFRESH_MS * 2);
      expect(listCalls).toBe(2);
      vi.useRealTimers();
    });

    it('shows a failed Excel update with its error and resynchronises on request', async () => {
      let resynced = false;
      const { requests } = renderAt('/workbooks', {
        'GET /workbooks': () => ({
          body: listOf(
            resynced
              ? { ...FIRST, syncStatus: 'synced' }
              : { ...FIRST, syncStatus: 'failed', syncError: 'ENOSPC: no space left on device' },
          ),
        }),
        'POST /workbooks/wb-1/sync': () => {
          resynced = true;
          return { status: 202, body: { workbookId: 'wb-1', state: 'pending' } };
        },
      });
      await screen.findByRole('listitem', { name: 'Daily Tasks' });
      expect(card('Daily Tasks').getByText('Excel update failed')).toBeInTheDocument();
      expect(card('Daily Tasks').getByText(/ENOSPC: no space left on device/)).toBeInTheDocument();
      expect(card('Daily Tasks').getByText(/Your tasks are saved/)).toBeInTheDocument();

      fireEvent.click(card('Daily Tasks').getByRole('button', { name: 'Resync now' }));

      await waitFor(() =>
        expect(card('Daily Tasks').queryByText('Excel update failed')).not.toBeInTheDocument(),
      );
      expect(requests.some((r) => r.method === 'POST' && r.path === '/workbooks/wb-1/sync')).toBe(
        true,
      );
    });

    it('offers a resync while an Excel update is being retried', async () => {
      renderAt('/workbooks', {
        'GET /workbooks': {
          body: listOf({ ...FIRST, syncStatus: 'retrying', syncError: 'EBUSY: resource busy' }),
        },
      });
      await screen.findByRole('listitem', { name: 'Daily Tasks' });
      expect(card('Daily Tasks').getByText('Excel update retrying')).toBeInTheDocument();
      expect(card('Daily Tasks').getByRole('button', { name: 'Resync now' })).toBeEnabled();
    });

    it('downloads the workbook as an .xlsx file', async () => {
      const createObjectURL = vi.fn(() => 'blob:workbook');
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      renderAt('/workbooks', {
        'GET /workbooks': { body: listOf(FIRST) },
        'GET /workbooks/wb-1/download': {
          raw: new Response(new Blob(['xlsx']), {
            status: 200,
            headers: {
              'Content-Disposition': `attachment; filename="Daily Tasks.xlsx"; filename*=UTF-8''Daily%20Tasks.xlsx`,
            },
          }),
        },
      });
      await screen.findByRole('listitem', { name: 'Daily Tasks' });

      fireEvent.click(card('Daily Tasks').getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(click).toHaveBeenCalled());
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe('Daily Tasks.xlsx');
      expect(link.href).toBe('blob:workbook');
    });
  });
});
