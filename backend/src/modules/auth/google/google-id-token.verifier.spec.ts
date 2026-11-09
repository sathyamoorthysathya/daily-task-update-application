import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  FakeGoogleIssuer,
  TEST_GOOGLE_CLIENT_ID,
} from '../../../../test/support/google-test-tokens.js';
import type { Env } from '../../../config/env.schema.js';
import { GoogleIdTokenVerifier } from './google-id-token.verifier.js';

const NONCE = 'nonce-123';

describe('GoogleIdTokenVerifier', () => {
  const issuer = new FakeGoogleIssuer();
  const config = { get: () => TEST_GOOGLE_CLIENT_ID } as unknown as ConfigService<Env, true>;
  const verifier = new GoogleIdTokenVerifier(issuer.createClient(), config);

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a valid token and normalises the identity', async () => {
    const token = issuer.sign({ nonce: NONCE, email: 'Jane.Doe@Example.com', name: 'Jane' });

    await expect(verifier.verify(token, NONCE)).resolves.toEqual({
      subject: '100000000000000000001',
      email: 'jane.doe@example.com',
      name: 'Jane',
    });
  });

  it.each([
    [
      'a forged signature',
      () => new FakeGoogleIssuer().sign({ nonce: NONCE }, { kid: issuer.kid }),
    ],
    [
      'a wrong audience',
      () => issuer.sign({ nonce: NONCE, aud: 'other-app.apps.googleusercontent.com' }),
    ],
    ['a wrong issuer', () => issuer.sign({ nonce: NONCE, iss: 'https://evil.example.com' })],
    [
      'an expired token',
      () => {
        const past = Math.floor(Date.now() / 1000) - 7200;
        return issuer.sign({ nonce: NONCE, iat: past, exp: past + 3600 });
      },
    ],
    ['a missing nonce', () => issuer.sign({})],
    ['a different nonce', () => issuer.sign({ nonce: 'someone-elses-nonce' })],
    ['garbage', () => 'not.a.jwt'],
  ])('rejects %s', async (_case, makeToken) => {
    await expect(verifier.verify(makeToken(), NONCE)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token when no nonce was issued to the browser', async () => {
    await expect(verifier.verify(issuer.sign({ nonce: NONCE }), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses identities whose email Google has not verified', async () => {
    const token = issuer.sign({ nonce: NONCE, email_verified: false });

    await expect(verifier.verify(token, NONCE)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
