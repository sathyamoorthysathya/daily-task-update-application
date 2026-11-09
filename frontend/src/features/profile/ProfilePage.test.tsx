import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import {
  apiError,
  clearCookies,
  type MockHandler,
  mockApi,
  NO_REFRESH,
  TEST_USER,
  UNAUTHENTICATED,
} from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import type { Profile } from './profile.types';

const PROFILE: Profile = {
  id: TEST_USER.id,
  email: TEST_USER.email,
  name: 'Jane Doe',
  emailVerified: true,
  hasPassword: true,
  phone: '+1 555 123 4567',
  companyName: 'Acme Corp',
  jobRole: 'Project Manager',
  industry: 'Information Technology',
  yearsOfExperience: 8,
  avatarVersion: null,
  connectedAccounts: [],
  createdAt: '2025-03-15T10:00:00.000Z',
  updatedAt: '2025-03-15T10:00:00.000Z',
};

const INDUSTRIES = ['Information Technology', 'Healthcare & Life Sciences', 'Other'];

function renderProfile(routesOverride: Record<string, MockHandler> = {}, profile = PROFILE) {
  const api = mockApi({
    'GET /auth/me': { body: { ...TEST_USER, name: profile.name } },
    'GET /profile': { body: profile },
    'GET /profile/industries': { body: { industries: INDUSTRIES } },
    'GET /auth/providers': { body: { google: { enabled: false } } },
    ...routesOverride,
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/profile'] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { ...api, router };
}

function detailsList() {
  return within(screen.getByTestId('profile-details'));
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ProfilePage', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the signed-in user’s profile and shows every field', async () => {
    const { requests } = renderProfile();

    await screen.findByRole('heading', { name: 'Personal & professional details' });
    const details = detailsList();
    expect(details.getByText('+1 555 123 4567')).toBeInTheDocument();
    expect(details.getByText('Acme Corp')).toBeInTheDocument();
    expect(details.getByText('Project Manager')).toBeInTheDocument();
    expect(details.getByText('Information Technology')).toBeInTheDocument();
    expect(details.getByText('8')).toBeInTheDocument();
    expect(details.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Project Manager at Acme Corp')).toBeInTheDocument();
    expect(screen.getByTestId('member-since')).toHaveTextContent(
      `Member since ${new Date(PROFILE.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    );
    // The profile is requested without any user ID: the API uses the session.
    expect(requests.some((r) => r.method === 'GET' && r.path === '/profile')).toBe(true);
  });

  it('shows "Not set" for empty optional fields', async () => {
    renderProfile({}, { ...PROFILE, phone: null, companyName: null, yearsOfExperience: null });

    await screen.findByTestId('profile-details');
    expect(detailsList().getAllByText('Not set')).toHaveLength(3);
  });

  it('edits and saves the profile, then shows the saved values', async () => {
    const { requests } = renderProfile({
      'PATCH /profile': (req) => ({ body: { ...PROFILE, ...(req.body as object) } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));

    expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
    fill('Full name', 'Jane Smith');
    fill('Phone number', '+44 20 7946 0958');
    fill('Company name', '');
    fill('Job role', 'Engineering Manager');
    fill('Industry', 'Healthcare & Life Sciences');
    fill('Years of experience', '12');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Your profile has been updated.')).toBeInTheDocument();
    const patch = requests.find((r) => r.method === 'PATCH' && r.path === '/profile');
    expect(patch?.body).toEqual({
      name: 'Jane Smith',
      phone: '+44 20 7946 0958',
      companyName: null,
      jobRole: 'Engineering Manager',
      industry: 'Healthcare & Life Sciences',
      yearsOfExperience: 12,
    });
    expect(patch?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
    expect(detailsList().getByText('Engineering Manager')).toBeInTheDocument();
    // The header shows the new name immediately.
    expect(screen.getByTestId('current-user')).toHaveTextContent('Jane Smith');
  });

  it('validates the form before saving', async () => {
    const { requests } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));

    fill('Full name', ' ');
    fill('Phone number', 'call me maybe');
    fill('Years of experience', '75');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a valid phone number, e.g. +1 555 123 4567'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 0 to 60')).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);

    // Correcting a field hides its error right away; the others stay.
    fill('Phone number', '+1 555 123 4567');
    expect(
      screen.queryByText('Enter a valid phone number, e.g. +1 555 123 4567'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('shows field errors returned by the server', async () => {
    renderProfile({
      'PATCH /profile': apiError(400, 'VALIDATION_FAILED', 'industry: Select an industry', {
        errors: [{ field: 'industry', message: 'Select an industry from the list' }],
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Select an industry from the list')).toBeInTheDocument();
  });

  it('cancels editing without saving', async () => {
    const { requests } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    fill('Job role', 'Something else');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(detailsList().getByText('Project Manager')).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  describe('avatar', () => {
    it('uploads a picture as multipart form data and displays it', async () => {
      const { requests } = renderProfile({
        'PUT /profile/avatar': { body: { ...PROFILE, avatarVersion: 1700000000000 } },
      });
      await screen.findByRole('button', { name: 'Upload photo' });
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', {
        type: 'image/png',
      });

      fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [file] } });

      await screen.findByRole('button', { name: 'Remove photo' });
      const upload = requests.find((r) => r.method === 'PUT');
      expect(upload?.path).toBe('/profile/avatar');
      const images = screen.getAllByTestId('avatar-image');
      expect(
        images.some((img) => img.getAttribute('src') === '/api/profile/avatar?v=1700000000000'),
      ).toBe(true);
    });

    it('rejects unsupported files before uploading', async () => {
      const { requests } = renderProfile();
      await screen.findByRole('button', { name: 'Upload photo' });
      const gif = new File(['GIF89a'], 'anim.gif', { type: 'image/gif' });

      fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [gif] } });

      expect(await screen.findByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
      expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    });

    it('removes the picture', async () => {
      const { requests } = renderProfile(
        { 'DELETE /profile/avatar': { body: { ...PROFILE, avatarVersion: null } } },
        { ...PROFILE, avatarVersion: 1 },
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));

      await screen.findByRole('button', { name: 'Upload photo' });
      expect(requests.some((r) => r.method === 'DELETE' && r.path === '/profile/avatar')).toBe(
        true,
      );
    });
  });

  describe('change password', () => {
    function fillPasswords(current: string, next: string, confirm = next) {
      fill('Current password', current);
      fill('New password', next);
      fill('Confirm new password', confirm);
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    }

    it('changes the password', async () => {
      const { requests } = renderProfile({ 'POST /auth/change-password': { status: 204 } });
      await screen.findByRole('heading', { name: 'Change password' });

      fillPasswords('Old-pass-123', 'New-pass-456');

      expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument();
      expect(requests.find((r) => r.path === '/auth/change-password')?.body).toEqual({
        currentPassword: 'Old-pass-123',
        newPassword: 'New-pass-456',
      });
      expect(screen.getByLabelText('Current password')).toHaveValue('');
    });

    it('validates the new password and confirmation', async () => {
      const { requests } = renderProfile();
      await screen.findByRole('heading', { name: 'Change password' });

      fillPasswords('Old-pass-123', 'short', 'different');

      expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      expect(requests.some((r) => r.path === '/auth/change-password')).toBe(false);
    });

    it('shows when the current password is wrong, without signing the user out', async () => {
      const { router } = renderProfile({
        'POST /auth/change-password': apiError(
          400,
          'INVALID_CURRENT_PASSWORD',
          'Current password is incorrect.',
          {
            errors: [{ field: 'currentPassword', message: 'Current password is incorrect.' }],
          },
        ),
      });
      await screen.findByRole('heading', { name: 'Change password' });

      fillPasswords('Wrong-pass-1', 'New-pass-456');

      expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/profile');
    });

    it('offers Google-only users a link to set a password', async () => {
      const { requests } = renderProfile(
        {
          'POST /auth/forgot-password': { status: 202, body: { message: 'sent' } },
        },
        {
          ...PROFILE,
          hasPassword: false,
          connectedAccounts: [
            {
              provider: 'google',
              email: 'jane@gmail.com',
              name: 'Jane G',
              pictureUrl: 'https://lh3.googleusercontent.com/a/pic',
              connectedAt: '2025-03-15T10:00:00.000Z',
              lastLoginAt: '2025-04-01T08:00:00.000Z',
            },
          ],
        },
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Email me a link to set a password' }),
      );

      expect(
        await screen.findByText(`We sent a link to ${PROFILE.email} to set your password.`),
      ).toBeInTheDocument();
      expect(requests.find((r) => r.path === '/auth/forgot-password')?.body).toEqual({
        email: PROFILE.email,
      });
      expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    });
  });

  it('shows the connected Google account', async () => {
    renderProfile(
      {},
      {
        ...PROFILE,
        connectedAccounts: [
          {
            provider: 'google',
            email: 'jane@gmail.com',
            name: 'Jane G',
            pictureUrl: null,
            connectedAt: '2025-03-15T10:00:00.000Z',
            lastLoginAt: '2025-04-01T08:00:00.000Z',
          },
        ],
      },
    );

    const section = within(
      (await screen.findByRole('heading', { name: 'Connected accounts' })).closest('section')!,
    );
    expect(section.getByText('Google')).toBeInTheDocument();
    expect(section.getByText('jane@gmail.com')).toBeInTheDocument();
    expect(section.getByText('Jane G')).toBeInTheDocument();
    expect(section.getByText('Connected', { selector: '.status-badge' })).toBeInTheDocument();
  });

  it('explains when no Google account is connected', async () => {
    renderProfile();
    expect(await screen.findByTestId('no-connected-accounts')).toBeInTheDocument();
  });

  it('logs out from the profile page', async () => {
    const { router } = renderProfile({ 'POST /auth/logout': { status: 204 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('You have been signed out.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('is only reachable when signed in', async () => {
    const { router } = renderProfile({
      'GET /auth/me': UNAUTHENTICATED,
      'POST /auth/refresh': NO_REFRESH,
    });

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
    await waitFor(() => expect(router.state.location.state).toEqual({ from: '/profile' }));
  });
});
