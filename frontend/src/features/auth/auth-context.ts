import { createContext, useContext } from 'react';
import type { AuthStatus, User } from './auth.types';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** One-off message for the sign-in page, e.g. "Your session has expired". */
  notice: string | null;
  clearNotice: () => void;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  /** Applies changes made elsewhere (e.g. the profile page) to the signed-in user. */
  updateUser: (changes: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
