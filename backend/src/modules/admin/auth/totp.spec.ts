import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp.js';
import { SecretBox } from './secret-box.js';

// RFC 6238 Appendix B / RFC 4226 Appendix D test secret.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP / TOTP', () => {
  it('matches the RFC 4226 HOTP test values', () => {
    expect(hotp(RFC_SECRET, 0n)).toBe('755224');
    expect(hotp(RFC_SECRET, 1n)).toBe('287082');
    expect(hotp(RFC_SECRET, 9n)).toBe('520489');
  });

  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
  ])('matches the RFC 6238 SHA-1 test value at %i s', (seconds, code) => {
    expect(hotp(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(code);
  });

  it('round-trips base32', () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb-oi')).toEqual(Buffer.from('foobar'));
  });

  it('generates 160-bit secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  describe('verifyTotp', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const codeAt = (timeMs: number) => hotp(base32Decode(secret), totpStep(timeMs));

    it('accepts the current code and one step of clock drift', () => {
      expect(verifyTotp(secret, codeAt(now), null, now)).toBe(totpStep(now));
      expect(verifyTotp(secret, codeAt(now - 30_000), null, now)).toBe(totpStep(now) - 1n);
      expect(verifyTotp(secret, codeAt(now + 30_000), null, now)).toBe(totpStep(now) + 1n);
    });

    it('rejects old codes, malformed input and replays', () => {
      expect(verifyTotp(secret, codeAt(now - 90_000), null, now)).toBeNull();
      expect(verifyTotp(secret, '12345', null, now)).toBeNull();
      expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
      // Already used: the same step (or an older one) is refused.
      expect(verifyTotp(secret, codeAt(now), totpStep(now), now)).toBeNull();
      expect(verifyTotp(secret, codeAt(now), totpStep(now) - 1n, now)).toBe(totpStep(now));
    });

    it('ignores spaces in the typed code', () => {
      const code = codeAt(now);
      expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, null, now)).not.toBeNull();
    });
  });

  it('builds an otpauth link for authenticator apps', () => {
    const uri = new URL(totpUri('JBSWY3DPEHPK3PXP', 'alice', 'Daily Task Update Admin'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Daily Task Update Admin:alice');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('digits')).toBe('6');
  });
});

describe('SecretBox', () => {
  const box = new SecretBox('a-server-secret-of-at-least-32-characters!', 'test');

  it('encrypts and decrypts', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    // Random IV: the same plaintext never gives the same ciphertext.
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
  });

  it('detects tampering and a different key', () => {
    const sealed = box.seal('secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other!').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() =>
      new SecretBox('another-server-secret-32-characters!!', 'test').open(sealed),
    ).toThrow();
    expect(() =>
      new SecretBox('a-server-secret-of-at-least-32-characters!', 'other').open(sealed),
    ).toThrow();
  });
});
