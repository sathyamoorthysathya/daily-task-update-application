import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthProvider';
import type {
  GoogleAccountsId,
  GoogleCredentialResponse,
} from '../features/auth/google/google-identity';
import {
  apiError,
  clearCookies,
  mockApi,
  NO_REFRESH,
  TEST_USER,
  UNAUTHENTICATED,
} from '../test/mock-api';
import { routes } from './routes';

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

const signedOut = {
  'GET /auth/me': UNAUTHENTICATED,
  'POST /auth/refresh': NO_REFRESH,
  'GET /auth/providers': { body: { google: { enabled: false } } },
};

function fill(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('authentication flows', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.google;
  });

  describe('protected routes', () => {
    it('redirects signed-out visitors from the dashboard to the sign-in page', async () => {
      mockApi(signedOut);
      const router = renderApp('/dashboard');

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.state).toEqual({ from: '/dashboard' });
    });

    it('sends signed-in users from the sign-in page to the dashboard', async () => {
      mockApi({ 'GET /auth/me': { body: TEST_USER } });
      const router = renderApp('/login');

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/dashboard');
      expect(screen.getByText('Welcome, Jane Doe!')).toBeInTheDocument();
    });
  });

  describe('login', () => {
    it('validates the form before calling the API', async () => {
      const { requests } = mockApi(signedOut);
      renderApp('/login');
      await screen.findByRole('heading', { name: 'Sign in' });

      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('Password is required')).toBeInTheDocument();
      expect(requests.some((r) => r.path === '/auth/login')).toBe(false);
    });

    it('shows the server message for wrong credentials', async () => {
      mockApi({
        ...signedOut,
        'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'),
      });
      renderApp('/login');
      await screen.findByRole('heading', { name: 'Sign in' });

      fill('Email', 'jane@example.com');
      fill('Password', 'wrong-pass-1');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    });

    it('redirects to the dashboard after a successful login', async () => {
      const { requests } = mockApi({
        ...signedOut,
        'POST /auth/login': { body: { user: TEST_USER } },
      });
      const router = renderApp('/login');
      await screen.findByRole('heading', { name: 'Sign in' });

      fill('Email', '  Jane@Example.com ');
      fill('Password', 'Sup3r-secret');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/dashboard');
      const login = requests.find((r) => r.path === '/auth/login');
      expect(login?.body).toEqual({ email: 'Jane@Example.com', password: 'Sup3r-secret' });
      expect(login?.headers.get('X-CSRF-Token')).toBe('test-csrf-token');
    });
  });

  describe('registration', () => {
    it('checks password strength and confirmation', async () => {
      mockApi(signedOut);
      renderApp('/register');
      await screen.findByRole('heading', { name: 'Create your account' });

      fill('Name', 'Jane');
      fill('Email', 'jane@example.com');
      fill('Password', 'onlyletters');
      fill('Confirm password', 'different');
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      expect(
        await screen.findByText('Password must contain at least one number'),
      ).toBeInTheDocument();
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('explains when the email is already registered', async () => {
      mockApi({
        ...signedOut,
        'POST /auth/register': apiError(
          409,
          'EMAIL_TAKEN',
          'An account with this email already exists. Sign in instead.',
        ),
      });
      renderApp('/register');
      await screen.findByRole('heading', { name: 'Create your account' });

      fill('Name', 'Jane');
      fill('Email', 'jane@example.com');
      fill('Password', 'Sup3r-secret');
      fill('Confirm password', 'Sup3r-secret');
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'An account with this email already exists',
      );
    });

    it('signs the new user in and opens the dashboard', async () => {
      mockApi({ ...signedOut, 'POST /auth/register': { status: 201, body: { user: TEST_USER } } });
      renderApp('/register');
      await screen.findByRole('heading', { name: 'Create your account' });

      fill('Name', 'Jane Doe');
      fill('Email', 'jane@example.com');
      fill('Password', 'Sup3r-secret');
      fill('Confirm password', 'Sup3r-secret');
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    });
  });

  describe('Google sign-in', () => {
    it('sends the Google credential to the API and opens the dashboard', async () => {
      type IdConfiguration = Parameters<GoogleAccountsId['initialize']>[0];
      let config: IdConfiguration | undefined;
      window.google = {
        accounts: {
          id: {
            initialize: vi.fn((c: IdConfiguration) => {
              config = c;
            }),
            renderButton: vi.fn(),
            disableAutoSelect: vi.fn(),
          },
        },
      };
      const { requests } = mockApi({
        ...signedOut,
        'GET /auth/providers': { body: { google: { enabled: true, clientId: 'client-123' } } },
        'GET /auth/google/nonce': { body: { nonce: 'nonce-abc' } },
        'POST /auth/google': { body: { user: { ...TEST_USER, providers: ['google'] } } },
      });
      const router = renderApp('/login');

      await waitFor(() => expect(config).toBeDefined());
      expect(config).toMatchObject({
        client_id: 'client-123',
        nonce: 'nonce-abc',
        ux_mode: 'popup',
      });
      expect(window.google.accounts.id.renderButton).toHaveBeenCalled();

      const response: GoogleCredentialResponse = { credential: 'google-id-token' };
      act(() => config?.callback(response));

      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/dashboard');
      expect(requests.find((r) => r.path === '/auth/google')?.body).toEqual({
        credential: 'google-id-token',
      });
    });

    it('hides the Google button when the provider is not configured', async () => {
      mockApi(signedOut);
      renderApp('/login');
      await screen.findByRole('heading', { name: 'Sign in' });

      await waitFor(() => expect(screen.queryByTestId('google-button')).not.toBeInTheDocument());
    });
  });

  describe('logout and session expiry', () => {
    it('signs out and returns to the sign-in page', async () => {
      const { requests } = mockApi({
        'GET /auth/me': { body: TEST_USER },
        'POST /auth/logout': { status: 204 },
        'GET /auth/providers': { body: { google: { enabled: false } } },
      });
      const router = renderApp('/dashboard');
      await screen.findByRole('heading', { name: 'Dashboard' });

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(await screen.findByText('You have been signed out.')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(requests.some((r) => r.method === 'POST' && r.path === '/auth/logout')).toBe(true);
    });

    it('returns to sign-in with a notice when the session has expired', async () => {
      mockApi({
        'GET /auth/me': { body: TEST_USER },
        // The access token has expired and the refresh token is no longer valid either.
        'GET /profile': apiError(401, 'TOKEN_EXPIRED', 'Your session has expired.'),
        'POST /auth/refresh': apiError(401, 'REFRESH_TOKEN_EXPIRED', 'Your session has expired.'),
        'GET /auth/providers': { body: { google: { enabled: false } } },
      });
      const router = renderApp('/dashboard');
      await screen.findByRole('heading', { name: 'Dashboard' });

      fireEvent.click(screen.getByRole('link', { name: 'Profile' }));

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(
        screen.getByText('Your session has expired. Please sign in again.'),
      ).toBeInTheDocument();
    });
  });

  describe('password reset', () => {
    it('confirms that a reset link was sent', async () => {
      mockApi({
        ...signedOut,
        'POST /auth/forgot-password': {
          status: 202,
          body: {
            message:
              'If an account exists for that email, we have sent a link to reset the password.',
          },
        },
      });
      renderApp('/forgot-password');
      await screen.findByRole('heading', { name: 'Forgot your password?' });

      fill('Email', 'jane@example.com');
      fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

      expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
    });

    it('sets a new password with the token from the link, then asks the user to sign in', async () => {
      const { requests } = mockApi({ ...signedOut, 'POST /auth/reset-password': { status: 204 } });
      const router = renderApp('/reset-password?token=reset-token-123');
      await screen.findByRole('heading', { name: 'Choose a new password' });
      // The token is removed from the address bar.
      await waitFor(() => expect(router.state.location.search).toBe(''));

      fill('New password', 'Brand-new-9');
      fill('Confirm new password', 'Brand-new-9');
      fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

      expect(await screen.findByText(/Your password has been reset/)).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(requests.find((r) => r.path === '/auth/reset-password')?.body).toEqual({
        token: 'reset-token-123',
        password: 'Brand-new-9',
      });
    });

    it('explains when the reset link is invalid or expired', async () => {
      mockApi({
        ...signedOut,
        'POST /auth/reset-password': apiError(400, 'RESET_TOKEN_INVALID', 'Invalid link'),
      });
      renderApp('/reset-password?token=expired');
      await screen.findByRole('heading', { name: 'Choose a new password' });

      fill('New password', 'Brand-new-9');
      fill('Confirm new password', 'Brand-new-9');
      fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
      expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
    });
  });
});
