import { env } from '../../config/env';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'X-CSRF-Token';

let pending: Promise<string> | null = null;

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

/**
 * Returns the CSRF token (double-submit cookie). The backend sets it in a readable cookie;
 * when it is missing, it is fetched from GET /auth/csrf.
 */
export function getCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) {
    return Promise.resolve(existing);
  }
  pending ??= fetch(`${env.apiBaseUrl}/auth/csrf`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`CSRF token request failed (${response.status})`);
      }
      return ((await response.json()) as { csrfToken: string }).csrfToken;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Forgets the current token (e.g. after the server rejected it) so a fresh one is fetched. */
export function resetCsrfToken(): void {
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`;
}
