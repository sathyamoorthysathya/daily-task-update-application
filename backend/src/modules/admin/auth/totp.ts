import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../../auth/crypto/token-crypto.js';

/**
 * Time-based one-time passwords (RFC 6238, as used by Google Authenticator, Microsoft
 * Authenticator, 1Password, ...): HMAC-SHA1, 6 digits, 30-second steps.
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Codes from one step before or after are accepted too (clock drift between phone and server). */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new random secret: 160 bits (the RFC's recommended length), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) for one counter value. */
export function hotp(secret: Buffer, counter: bigint, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timeMs = Date.now()): bigint {
  return BigInt(Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS));
}

/**
 * Checks a code. Returns the time step it belongs to (store it: a code must not be accepted
 * twice), or null when it is wrong, malformed or not newer than `lastUsedStep`.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedStep: bigint | null,
  timeMs = Date.now(),
): bigint | null {
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  const current = totpStep(timeMs);
  let matched: bigint | null = null;
  // Every candidate is computed and compared (no early exit): constant work per attempt.
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const step = current + BigInt(drift);
    if (safeEqual(hotp(secret, step), normalized) && matched === null) {
      matched = step;
    }
  }
  if (matched === null || (lastUsedStep !== null && matched <= lastUsedStep)) {
    return null;
  }
  return matched;
}

/** otpauth:// link understood by authenticator apps (also encoded in the set-up QR code). */
export function totpUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
