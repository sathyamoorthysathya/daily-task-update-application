import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { AppShellSkeleton, AuthSkeleton } from '../../components/Skeletons';
import { onAdminSessionExpired } from '../../lib/api/session-events';
import {
  AdminAuthContext,
  type AdminAuthValue,
  adminRedirectTarget,
  type AdminStatus,
  useAdminAuth,
} from './admin-auth-context';
import { adminApi } from './admin.api';
import type { AdminProfile } from './admin.types';
import { AdminLayout } from './components/AdminLayout';
import './admin.css';

const SESSION_ENDED = 'Your admin session has ended. Please sign in again.';
const SIGNED_OUT = 'You have signed out of the admin panel.';

/**
 * Root of /admin: the administrator's session (separate from the app user's session; the
 * admin cookie is only sent to the admin API).
 */
export function AdminRoot() {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [status, setStatus] = useState<AdminStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<AdminStatus>('loading');

  const apply = useCallback((next: AdminProfile | null) => {
    const nextStatus: AdminStatus = next ? 'authenticated' : 'unauthenticated';
    statusRef.current = nextStatus;
    setAdmin(next);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    let active = true;
    adminApi.me().then(
      (me) => active && apply(me),
      () => active && apply(null),
    );
    return () => {
      active = false;
    };
  }, [apply]);

  // Any admin request answered 401: idle timeout, session revoked, password changed elsewhere.
  useEffect(
    () =>
      onAdminSessionExpired(() => {
        if (statusRef.current === 'authenticated') {
          setNotice(SESSION_ENDED);
          apply(null);
        }
      }),
    [apply],
  );

  // The session's absolute end: sign out locally when it is reached.
  useEffect(() => {
    if (!admin) {
      return;
    }
    const remaining = new Date(admin.session.expiresAt).getTime() - Date.now();
    const timer = setTimeout(
      () => {
        setNotice(SESSION_ENDED);
        apply(null);
      },
      Math.max(0, Math.min(remaining, 2_147_000_000)),
    );
    return () => clearTimeout(timer);
  }, [admin, apply]);

  const login = useCallback(
    async (username: string, password: string, code?: string) => {
      const { admin: next } = await adminApi.login({ username, password, code });
      setNotice(null);
      apply(next);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
      setNotice(SIGNED_OUT);
    } finally {
      apply(null);
    }
  }, [apply]);

  const refresh = useCallback(async () => {
    apply(await adminApi.me());
  }, [apply]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<AdminAuthValue>(
    () => ({ status, admin, notice, clearNotice, login, logout, refresh }),
    [status, admin, notice, clearNotice, login, logout, refresh],
  );

  return (
    <AdminAuthContext value={value}>
      <Outlet />
    </AdminAuthContext>
  );
}

/** Admin pages: signed-in administrators only, inside the admin layout. */
export function AdminProtectedRoute() {
  const { status } = useAdminAuth();
  const location = useLocation();
  if (status === 'loading') {
    return <AppShellSkeleton />;
  }
  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <AdminLayout />;
}

/** The admin sign-in page: a signed-in administrator goes straight to the panel. */
export function AdminGuestRoute() {
  const { status } = useAdminAuth();
  const location = useLocation();
  if (status === 'loading') {
    return <AuthSkeleton />;
  }
  if (status === 'authenticated') {
    // Right after signing in: on to the admin page that was asked for.
    return <Navigate to={adminRedirectTarget(location.state)} replace />;
  }
  return <Outlet />;
}
