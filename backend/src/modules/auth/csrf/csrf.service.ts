import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { generateOpaqueToken, hmacSha256, safeEqual } from '../crypto/token-crypto.js';

/**
 * Signed double-submit cookie CSRF protection (OWASP CSRF Prevention Cheat Sheet).
 * Token = `<random>.<HMAC(secret, random)>`. The token is stored in a readable cookie and must
 * be echoed in the X-CSRF-Token header; the signature stops attackers from planting their own
 * token via cookie injection.
 */
@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('CSRF_SECRET', { infer: true });
  }

  generate(): string {
    const value = generateOpaqueToken();
    return `${value}.${hmacSha256(this.secret, value)}`;
  }

  isWellFormed(token: string | undefined): token is string {
    if (!token) {
      return false;
    }
    const [value, signature, ...rest] = token.split('.');
    if (!value || !signature || rest.length > 0) {
      return false;
    }
    return safeEqual(signature, hmacSha256(this.secret, value));
  }

  /** True when the header token matches the cookie token and carries a valid signature. */
  verify(cookieToken: string | undefined, headerToken: string | undefined): boolean {
    return (
      this.isWellFormed(cookieToken) &&
      typeof headerToken === 'string' &&
      safeEqual(cookieToken, headerToken)
    );
  }
}
