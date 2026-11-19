import { createContext, useContext } from 'react';
import type { AdminProfile } from './admin.types';

export type AdminStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AdminAuthValue {
  status: AdminStatus;
  admin: AdminProfile | null;
  /** Shown on the sign-in page (e.g. "Your admin session ended"). */
  notice: string | null;
  clearNotice: () => void;
  /** Throws ApiError (TWO_FACTOR_REQUIRED, INVALID_CREDENTIALS, ACCOUNT_LOCKED, ...). */
  login: (username: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the profile (after changing two-step verification). */
  refresh: () => Promise<void>;
}

export const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthContext);
  if (!value) {
    throw new Error('useAdminAuth must be used inside the admin routes');
  }
  return value;
}

/** Where to go after signing in: the admin page asked for (admin paths only), else /admin. */
export function adminRedirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/admin') && !from.startsWith('//')
    ? from
    : '/admin';
}
