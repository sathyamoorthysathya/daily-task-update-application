import type { Request } from 'express';

/** HttpOnly, SameSite=Strict cookie holding the admin session token (admin API path only). */
export const ADMIN_SESSION_COOKIE = 'admin_session';

/** Name shown in authenticator apps next to the administrator's username. */
export const TOTP_ISSUER = 'Daily Task Update Admin';

/** Machine-readable codes returned in the `code` field of admin error responses. */
export const AdminErrorCode = {
  Unauthenticated: 'ADMIN_UNAUTHENTICATED',
  SessionExpired: 'ADMIN_SESSION_EXPIRED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  TwoFactorRequired: 'TWO_FACTOR_REQUIRED',
  TwoFactorInvalid: 'TWO_FACTOR_INVALID',
  AccountLocked: 'ACCOUNT_LOCKED',
  IpNotAllowed: 'ADMIN_IP_NOT_ALLOWED',
  InvalidCurrentPassword: 'INVALID_CURRENT_PASSWORD',
  PasswordUnchanged: 'PASSWORD_UNCHANGED',
  TwoFactorAlreadyEnabled: 'TWO_FACTOR_ALREADY_ENABLED',
  TwoFactorNotEnabled: 'TWO_FACTOR_NOT_ENABLED',
  TwoFactorSetupMissing: 'TWO_FACTOR_SETUP_MISSING',
  UserNotFound: 'USER_NOT_FOUND',
} as const;

/** The administrator attached to the request by AdminSessionGuard. */
export interface AdminIdentity {
  id: string;
  username: string;
  sessionId: string;
}

export type AdminRequest = Request & { admin?: AdminIdentity };
