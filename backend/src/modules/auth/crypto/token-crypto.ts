import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hex digest. Suitable for high-entropy random tokens (refresh/reset tokens);
 * passwords must use Argon2id instead.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
