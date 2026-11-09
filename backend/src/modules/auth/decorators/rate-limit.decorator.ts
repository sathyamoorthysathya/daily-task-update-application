import { SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMIT_KEY = 'auth:rateLimit';
export const LOGIN_RATE_LIMIT_KEY = 'auth:loginRateLimit';

/** Applies the per-IP `auth` throttler (AUTH_RATE_LIMIT requests per minute). */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

/** Applies the per-IP-and-email `login` throttler (LOGIN_RATE_LIMIT attempts per 15 minutes). */
export const LoginRateLimit = () => SetMetadata(LOGIN_RATE_LIMIT_KEY, true);

export const WRITE_RATE_LIMIT_KEY = 'app:writeRateLimit';

/** Applies the per-session `write` throttler (WRITE_RATE_LIMIT changes per minute). */
export const WriteRateLimit = () => SetMetadata(WRITE_RATE_LIMIT_KEY, true);
