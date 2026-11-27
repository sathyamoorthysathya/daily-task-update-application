import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, clearCookies, mockApi } from '../../test/mock-api';
import { GoogleSignInButton } from './components/GoogleSignInButton';

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    clearCookies();
    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          renderButton: vi.fn((parent: HTMLElement) => {
            parent.append(document.createElement('iframe'));
          }),
          disableAutoSelect: vi.fn(),
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.google;
  });

  it('offers to try again when Google sign-in could not load, and then shows the button', async () => {
    let calls = 0;
    mockApi({
      // The API is briefly unavailable (e.g. restarting), then answers.
      'GET /auth/providers': () => {
        calls += 1;
        return calls === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
          : { body: { google: { enabled: true, clientId: 'client-123' } } };
      },
      'GET /auth/google/nonce': { body: { nonce: 'nonce-abc' } },
    });
    render(<GoogleSignInButton onCredential={vi.fn()} retryDelaysMs={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading Google sign-in…');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google sign-in couldn’t load.');
    expect(window.google!.accounts.id.renderButton).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await vi.waitFor(() => expect(window.google!.accounts.id.renderButton).toHaveBeenCalled());
    expect(await screen.findByTestId('google-button')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retries quietly before showing the error', async () => {
    let calls = 0;
    mockApi({
      'GET /auth/providers': () => {
        calls += 1;
        return calls < 3
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable')
          : { body: { google: { enabled: true, clientId: 'client-123' } } };
      },
      'GET /auth/google/nonce': { body: { nonce: 'nonce-abc' } },
    });
    render(<GoogleSignInButton onCredential={vi.fn()} retryDelaysMs={[0, 0]} />);

    await vi.waitFor(() => expect(window.google!.accounts.id.renderButton).toHaveBeenCalled());
    expect(calls).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
