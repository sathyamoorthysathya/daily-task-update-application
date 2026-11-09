import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const TEST_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

export interface GoogleTestClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
  aud?: string;
  iss?: string;
  iat?: number;
  exp?: number;
}

/**
 * Stand-in for Google's signing infrastructure: an RSA key pair whose public key is served
 * to google-auth-library in place of Google's certificates. Everything else (RS256 signature,
 * issuer, audience, expiry checks) runs through the real library code.
 */
export class FakeGoogleIssuer {
  readonly kid = `test-${randomUUID()}`;
  private readonly privateKey: KeyObject;
  private readonly publicKeyPem: string;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /** An OAuth2Client that trusts only this issuer's key (no network access). */
  createClient(): OAuth2Client {
    const client = new OAuth2Client();
    client.getFederatedSignonCertsAsync = () =>
      Promise.resolve({ certs: { [this.kid]: this.publicKeyPem }, format: 'PEM' } as never);
    return client;
  }

  sign(claims: GoogleTestClaims, options: { kid?: string } = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'https://accounts.google.com',
      aud: TEST_GOOGLE_CLIENT_ID,
      azp: TEST_GOOGLE_CLIENT_ID,
      sub: '100000000000000000001',
      email: 'google.user@example.com',
      email_verified: true,
      name: 'Google User',
      iat: now,
      exp: now + 3600,
      ...claims,
    };
    const header = { alg: 'RS256', typ: 'JWT', kid: options.kid ?? this.kid };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), this.privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }
}
