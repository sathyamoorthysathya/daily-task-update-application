import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onSessionExpired } from '../../lib/api/session-events';
import { authApi } from './auth.api';
import { AuthContext, type AuthContextValue } from './auth-context';
import type { AuthStatus, User } from './auth.types';
import { SESSION_EXPIRED_NOTICE, SIGNED_OUT_NOTICE } from './auth-messages';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<AuthStatus>('loading');

  const applyUser = useCallback((next: User | null) => {
    const nextStatus: AuthStatus = next ? 'authenticated' : 'unauthenticated';
    statusRef.current = nextStatus;
    setUser(next);
    setStatus(nextStatus);
  }, []);

  // Restore the session on page load (the access/refresh cookies are HttpOnly).
  useEffect(() => {
    let active = true;
    authApi.me().then(
      (me) => active && applyUser(me),
      () => active && applyUser(null),
    );
    return () => {
      active = false;
    };
  }, [applyUser]);

  // A request failed with 401 and the session could not be refreshed.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (statusRef.current === 'authenticated') {
          setNotice(SESSION_EXPIRED_NOTICE);
          applyUser(null);
        }
      }),
    [applyUser],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { user: next } = await authApi.login({ email, password });
      applyUser(next);
      return next;
    },
    [applyUser],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const { user: next } = await authApi.register({ name, email, password });
      applyUser(next);
      return next;
    },
    [applyUser],
  );

  const loginWithGoogle = useCallback(
    async (credential: string) => {
      const { user: next } = await authApi.google(credential);
      applyUser(next);
      return next;
    },
    [applyUser],
  );

  // The protected route redirects to /login as soon as the user is cleared; the notice is
  // shown there. The local session is cleared even if the request fails.
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
      setNotice(SIGNED_OUT_NOTICE);
    } finally {
      applyUser(null);
    }
  }, [applyUser]);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
      setNotice(SIGNED_OUT_NOTICE);
    } finally {
      applyUser(null);
    }
  }, [applyUser]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const updateUser = useCallback((changes: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...changes } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      notice,
      clearNotice,
      login,
      register,
      loginWithGoogle,
      logout,
      logoutAll,
      updateUser,
    }),
    [
      status,
      user,
      notice,
      clearNotice,
      login,
      register,
      loginWithGoogle,
      logout,
      logoutAll,
      updateUser,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
