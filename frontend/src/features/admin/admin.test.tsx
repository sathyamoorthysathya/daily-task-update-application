import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { apiError, clearCookies, mockApi, NO_REFRESH, UNAUTHENTICATED } from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { AdminProfile, AdminUserDetail, AdminUserRow, Overview } from './admin.types';

const ADMIN: AdminProfile = {
  id: '0190a000-0000-7000-8000-0000000000a1',
  username: 'chief',
  displayName: 'Chief Admin',
  twoFactorEnabled: false,
  passwordChangedAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  previousSignIn: null,
  session: { expiresAt: '2099-01-01T00:00:00.000Z', idleTimeoutMinutes: 30 },
};

const days = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`,
    signups: index % 3,
    views: index * 2,
    visitors: index,
    entries: index % 4,
  }));

const OVERVIEW: Overview = {
  period: { days: 30, timeZone: 'UTC' },
  users: {
    total: 42,
    active: 40,
    disabled: 2,
    verified: 30,
    withGoogle: 12,
    withPassword: 35,
    newLast7Days: 5,
    newLast30Days: 14,
    activeLastDay: 9,
    activeLast7Days: 21,
    activeLast30Days: 33,
  },
  content: { workbooks: 50, tasks: 400, entries: 2100, activeSessions: 17 },
  daily: days(30),
  topPages: [{ path: '/dashboard', views: 120, visitors: 30, users: 25 }],
  devices: [{ name: 'desktop', views: 100 }],
  recentUsers: [
    {
      id: '0190a000-0000-7000-8000-000000000001',
      name: 'Jane Doe',
      email: 'jane@example.com',
      createdAt: '2026-11-17T10:00:00.000Z',
    },
  ],
  topUsers: [],
  security: {
    failedSignInsLastDay: 3,
    failedAdminSignInsLastDay: 0,
    lockedAdmins: 0,
    tokenReuseLast7Days: 0,
  },
};

const USER_ROW: AdminUserRow = {
  id: '0190a000-0000-7000-8000-000000000001',
  name: 'Jane Doe',
  email: 'jane@example.com',
  emailVerified: true,
  providers: ['google'],
  hasPassword: true,
  disabled: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  lastSeenAt: null,
  workbooks: 1,
  tasks: 4,
  entries: 12,
};

const USER_DETAIL: AdminUserDetail = {
  ...USER_ROW,
  disabledAt: null,
  disabledReason: null,
  profile: {
    phone: null,
    companyName: 'Acme',
    jobRole: null,
    industry: null,
    yearsOfExperience: 3,
  },
  accounts: [],
  tasksByStatus: { TO_DO: 1, IN_PROGRESS: 2, PENDING: 0, COMPLETED: 1, ON_HOLD: 0 },
  lastEntryAt: null,
  last30Days: { entries: 5, views: 9 },
  workbookList: [],
  sessions: [
    {
      id: 's1',
      startedAt: '2026-11-17T10:00:00.000Z',
      lastActiveAt: '2026-11-17T11:00:00.000Z',
      expiresAt: '2026-11-24T10:00:00.000Z',
      ip: '203.0.113.7',
      browser: 'Chrome',
      os: 'Windows',
      deviceType: 'desktop',
    },
  ],
  topPages: [],
  recentVisits: [],
  recentEvents: [],
};

const signedOutUser = { 'GET /auth/me': UNAUTHENTICATED, 'POST /auth/refresh': NO_REFRESH };

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

function fill(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('admin panel', () => {
  beforeEach(() => clearCookies());
  afterEach(() => vi.restoreAllMocks());

  it('sends signed-out visitors to the admin sign-in page', async () => {
    mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': apiError(
        401,
        'ADMIN_UNAUTHENTICATED',
        'Administrator sign-in required.',
      ),
    });
    const router = renderAt('/admin/users');

    expect(await screen.findByRole('heading', { name: 'Admin sign-in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/login');
    expect(router.state.location.state).toEqual({ from: '/admin/users' });
  });

  it('signs in with username, password and the two-step code, then shows the overview', async () => {
    let signedIn = false;
    const { requests } = mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': () =>
        signedIn ? { body: ADMIN } : apiError(401, 'ADMIN_UNAUTHENTICATED', 'Sign in.'),
      'POST /admin/auth/login': (request) => {
        const body = request.body as { code?: string };
        if (!body.code) {
          return apiError(401, 'TWO_FACTOR_REQUIRED', 'Enter the 6-digit code.');
        }
        signedIn = true;
        return { body: { admin: { ...ADMIN, twoFactorEnabled: true } } };
      },
      'GET /admin/overview': { body: OVERVIEW },
    });
    const router = renderAt('/admin/login');
    await screen.findByRole('heading', { name: 'Admin sign-in' });

    fill('Username', 'Chief');
    fill('Password', 'Adm1n-Pass-word!');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    fill('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
    const logins = requests.filter((r) => r.path === '/admin/auth/login');
    expect(logins.map((r) => r.body)).toEqual([
      { username: 'Chief', password: 'Adm1n-Pass-word!' },
      { username: 'Chief', password: 'Adm1n-Pass-word!', code: '123456' },
    ]);
    // Sent with the CSRF header, and the figures come in the admin's time zone.
    expect(logins[0]?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
    expect(requests.find((r) => r.path === '/admin/overview')?.query.get('tz')).toBeTruthy();

    const figures = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(figures).getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Signed in with two-step verification')).toBeInTheDocument();
  });

  it('shows the lockout message', async () => {
    mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': apiError(401, 'ADMIN_UNAUTHENTICATED', 'Sign in.'),
      'POST /admin/auth/login': apiError(
        429,
        'ACCOUNT_LOCKED',
        'Too many failed sign-in attempts. This account is locked for 15 minutes.',
      ),
    });
    renderAt('/admin/login');
    await screen.findByRole('heading', { name: 'Admin sign-in' });
    fill('Username', 'chief');
    fill('Password', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('locked for 15 minutes');
  });

  it('lists users with search in the URL', async () => {
    const { requests } = mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': { body: ADMIN },
      'GET /admin/users': (request) => ({
        body: {
          items: request.query.get('search') === 'nobody' ? [] : [USER_ROW],
          total: request.query.get('search') === 'nobody' ? 0 : 1,
          page: 1,
          pageSize: 20,
        },
      }),
    });
    const router = renderAt('/admin/users');

    const row = await screen.findByRole('link', { name: /Jane Doe/ });
    expect(row).toHaveAttribute('href', `/admin/users/${USER_ROW.id}`);
    expect(screen.getByText('Google')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), {
      target: { value: 'nobody' },
    });
    expect(await screen.findByText('No users found')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?search=nobody');
    expect(requests.at(-1)?.query.get('search')).toBe('nobody');
  });

  it('disables a user with a reason after confirmation', async () => {
    const { requests } = mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': { body: ADMIN },
      [`GET /admin/users/${USER_ROW.id}`]: { body: USER_DETAIL },
      [`POST /admin/users/${USER_ROW.id}/disable`]: {
        body: {
          ...USER_DETAIL,
          disabled: true,
          disabledAt: '2026-11-18T10:00:00.000Z',
          disabledReason: 'Left the company',
          sessions: [],
        },
      },
    });
    renderAt(`/admin/users/${USER_ROW.id}`);

    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disable account' }));

    const dialog = await screen.findByRole('dialog', { name: 'Disable Jane Doe?' });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: 'Left the company' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable account' }));

    expect(await screen.findByText(/was disabled and signed out/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable account' })).toBeInTheDocument();
    expect(requests.find((r) => r.path.endsWith('/disable'))?.body).toEqual({
      reason: 'Left the company',
    });
  });

  it('returns to the sign-in page when the admin session ends', async () => {
    mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': { body: ADMIN },
      'GET /admin/overview': apiError(
        401,
        'ADMIN_SESSION_EXPIRED',
        'Your admin session has ended.',
      ),
    });
    const router = renderAt('/admin');

    expect(await screen.findByText(/Your admin session has ended/)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/login'));
  });

  it('sets up two-step verification with a QR code and a confirmation code', async () => {
    let enabled = false;
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const { requests } = mockApi({
      ...signedOutUser,
      'GET /admin/auth/me': () => ({ body: { ...ADMIN, twoFactorEnabled: enabled } }),
      'GET /admin/auth/sessions': { body: { sessions: [] } },
      'GET /admin/auth/admins': { body: { admins: [] } },
      'POST /admin/auth/two-factor/setup': {
        body: {
          secret,
          otpauthUri: `otpauth://totp/Daily%20Task%20Update%20Admin%3Achief?secret=${secret}&issuer=Daily+Task+Update+Admin&algorithm=SHA1&digits=6&period=30`,
        },
      },
      'POST /admin/auth/two-factor/enable': () => {
        enabled = true;
        return { status: 204 };
      },
    });
    renderAt('/admin/settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    fill('Confirm your password', 'Adm1n-Pass-word!');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const qr = await screen.findByRole('img', {
      name: 'QR code for setting up two-step verification',
    });
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
    expect(screen.getByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');

    fill('6-digit code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText('Two-step verification is on.')).toBeInTheDocument();
    expect(requests.find((r) => r.path === '/admin/auth/two-factor/enable')?.body).toEqual({
      code: '123456',
    });
  });
});
