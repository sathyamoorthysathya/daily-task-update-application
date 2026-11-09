import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../../../config/env.schema.js';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_COOKIE,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_NONCE_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
} from '../auth.constants.js';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Writes and clears authentication cookies.
 * - access_token:  HttpOnly, sent to every API route.
 * - refresh_token: HttpOnly, SameSite=Strict, only sent to /<prefix>/auth routes.
 * - csrf_token:    readable by the SPA (double-submit pattern), not a credential.
 */
@Injectable()
export class AuthCookieService {
  private readonly secure: boolean;
  private readonly apiPath: string;
  private readonly authPath: string;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;

  constructor(config: ConfigService<Env, true>) {
    const prefix = config.get('API_PREFIX', { infer: true });
    this.secure = config.get('COOKIE_SECURE', { infer: true });
    this.apiPath = `/${prefix}`;
    this.authPath = `/${prefix}/auth`;
    this.accessTtlMs = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }) * 1000;
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  setSessionCookies(res: Response, tokens: SessionTokens): void {
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...this.base(this.apiPath, 'lax'),
      maxAge: this.accessTtlMs,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...this.base(this.authPath, 'strict'),
      maxAge: this.refreshTtlMs,
    });
  }

  clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, this.base(this.apiPath, 'lax'));
    res.clearCookie(REFRESH_TOKEN_COOKIE, this.base(this.authPath, 'strict'));
  }

  setCsrfCookie(res: Response, token: string): void {
    res.cookie(CSRF_COOKIE, token, { ...this.base('/', 'strict'), httpOnly: false });
  }

  setGoogleNonceCookie(res: Response, nonce: string): void {
    res.cookie(GOOGLE_NONCE_COOKIE, nonce, {
      ...this.base(`${this.authPath}/google`, 'strict'),
      maxAge: GOOGLE_NONCE_TTL_SECONDS * 1000,
    });
  }

  clearGoogleNonceCookie(res: Response): void {
    res.clearCookie(GOOGLE_NONCE_COOKIE, this.base(`${this.authPath}/google`, 'strict'));
  }

  private base(path: string, sameSite: 'lax' | 'strict'): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite, path };
  }
}
