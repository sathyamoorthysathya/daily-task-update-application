import type { Request } from 'express';

/** Identity attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  /** Login session (refresh token family) the access token belongs to. */
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

/** Client metadata stored with refresh tokens to help users recognise their sessions. */
export interface ClientInfo {
  userAgent?: string;
  ipAddress?: string;
}
