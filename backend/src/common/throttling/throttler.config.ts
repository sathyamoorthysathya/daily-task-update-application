import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { minutes, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';
import { ACCESS_TOKEN_COOKIE } from '../../modules/auth/auth.constants.js';
import {
  AUTH_RATE_LIMIT_KEY,
  LOGIN_RATE_LIMIT_KEY,
  WRITE_RATE_LIMIT_KEY,
} from '../../modules/auth/decorators/rate-limit.decorator.js';

const reflector = new Reflector();

const isMarked = (key: string, context: ExecutionContext) =>
  reflector.getAllAndOverride<boolean | undefined>(key, [
    context.getHandler(),
    context.getClass(),
  ]) === true;

const emailOf = (request: Request) => {
  const body = request.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
};

/**
 * Throttlers (in-memory storage: run one API instance, or use a shared store such as Redis
 * when running several). Client IPs are correct only when TRUST_PROXY matches the proxies.
 * - default:       API_RATE_LIMIT requests/minute per IP on every route.
 * - auth:          AUTH_RATE_LIMIT requests/minute per IP on @AuthRateLimit() routes.
 * - login:         LOGIN_RATE_LIMIT attempts/15 minutes per IP + email (@LoginRateLimit()).
 * - login-account: LOGIN_ACCOUNT_RATE_LIMIT attempts/15 minutes per email from any IP, so that
 *                  rotating IP addresses does not help guessing one account's password.
 * - write:         WRITE_RATE_LIMIT task changes/minute per session (@WriteRateLimit()).
 */
export function throttlerOptionsFactory(config: ConfigService<Env, true>): ThrottlerModuleOptions {
  return {
    errorMessage: (_context, detail) =>
      `Too many attempts. Please wait ${Math.max(1, Math.ceil(detail.timeToBlockExpire))} seconds and try again.`,
    throttlers: [
      { name: 'default', ttl: minutes(1), limit: config.get('API_RATE_LIMIT', { infer: true }) },
      {
        name: 'auth',
        ttl: minutes(1),
        limit: config.get('AUTH_RATE_LIMIT', { infer: true }),
        skipIf: (context) => !isMarked(AUTH_RATE_LIMIT_KEY, context),
      },
      {
        name: 'login',
        ttl: minutes(15),
        limit: config.get('LOGIN_RATE_LIMIT', { infer: true }),
        skipIf: (context) => !isMarked(LOGIN_RATE_LIMIT_KEY, context),
        getTracker: (req: Record<string, unknown>) => {
          const request = req as unknown as Request;
          return `${request.ip ?? 'unknown'}|${emailOf(request)}`;
        },
      },
      {
        name: 'login-account',
        ttl: minutes(15),
        limit: config.get('LOGIN_ACCOUNT_RATE_LIMIT', { infer: true }),
        skipIf: (context) => !isMarked(LOGIN_RATE_LIMIT_KEY, context),
        getTracker: (req: Record<string, unknown>) =>
          `account|${emailOf(req as unknown as Request)}`,
      },
      {
        name: 'write',
        ttl: minutes(1),
        limit: config.get('WRITE_RATE_LIMIT', { infer: true }),
        skipIf: (context) => !isMarked(WRITE_RATE_LIMIT_KEY, context),
        // Runs before authentication: key on the session cookie (hashed), else on the IP.
        getTracker: (req: Record<string, unknown>) => {
          const request = req as unknown as Request;
          const cookies = request.cookies as Record<string, string | undefined> | undefined;
          const session = cookies?.[ACCESS_TOKEN_COOKIE];
          return session
            ? `session|${createHash('sha256').update(session).digest('hex')}`
            : `ip|${request.ip ?? 'unknown'}`;
        },
      },
    ],
  };
}
