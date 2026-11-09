export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const GOOGLE_NONCE_COOKIE = 'g_nonce';
export const CSRF_HEADER = 'x-csrf-token';

export const JWT_ISSUER = 'daily-task-update-api';
export const JWT_AUDIENCE = 'daily-task-update-web';

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const GOOGLE_NONCE_TTL_SECONDS = 600;

/** Machine-readable codes returned in the `code` field of auth error responses. */
export const AuthErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  TokenExpired: 'TOKEN_EXPIRED',
  InvalidToken: 'INVALID_TOKEN',
  SessionRevoked: 'SESSION_REVOKED',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  EmailTaken: 'EMAIL_TAKEN',
  RefreshTokenMissing: 'REFRESH_TOKEN_MISSING',
  RefreshTokenInvalid: 'REFRESH_TOKEN_INVALID',
  RefreshTokenExpired: 'REFRESH_TOKEN_EXPIRED',
  RefreshTokenReused: 'REFRESH_TOKEN_REUSED',
  CsrfTokenInvalid: 'CSRF_TOKEN_INVALID',
  GoogleDisabled: 'GOOGLE_SIGN_IN_DISABLED',
  GoogleTokenInvalid: 'GOOGLE_TOKEN_INVALID',
  GoogleEmailNotVerified: 'GOOGLE_EMAIL_NOT_VERIFIED',
  ResetTokenInvalid: 'RESET_TOKEN_INVALID',
  PasswordNotSet: 'PASSWORD_NOT_SET',
  InvalidCurrentPassword: 'INVALID_CURRENT_PASSWORD',
  PasswordUnchanged: 'PASSWORD_UNCHANGED',
  Forbidden: 'FORBIDDEN',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
