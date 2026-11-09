import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../../../config/env.schema.js';
import { AuthErrorCode, GOOGLE_ISSUERS } from '../auth.constants.js';
import { safeEqual } from '../crypto/token-crypto.js';

export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

export interface GoogleIdentity {
  /** Stable Google account ID (`sub`). */
  subject: string;
  email: string;
  name: string;
  /** HTTPS profile picture URL from Google, if any. */
  pictureUrl?: string;
}

const invalidToken = () =>
  new UnauthorizedException({
    code: AuthErrorCode.GoogleTokenInvalid,
    message: 'Google sign-in could not be verified. Please try again.',
  });

/**
 * Verifies Google ID tokens (OpenID Connect) with Google's official library:
 * RS256 signature against Google's published certificates, issuer, audience (our client ID)
 * and expiry. Additionally checks the nonce bound to this browser and that Google has
 * verified the email address.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly clientId: string | undefined;

  constructor(
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly client: OAuth2Client,
    config: ConfigService<Env, true>,
  ) {
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
  }

  get enabled(): boolean {
    return this.clientId !== undefined;
  }

  get publicClientId(): string | undefined {
    return this.clientId;
  }

  async verify(idToken: string, expectedNonce: string | undefined): Promise<GoogleIdentity> {
    const clientId = this.clientId;
    if (!clientId) {
      throw new ServiceUnavailableException({
        code: AuthErrorCode.GoogleDisabled,
        message: 'Google sign-in is not available.',
      });
    }

    let payload;
    try {
      // Always pass `audience`: without it the library skips the audience check.
      const ticket = await this.client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `Rejected Google ID token: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw invalidToken();
    }

    // Defence in depth: re-check the critical claims explicitly.
    if (
      !payload?.sub ||
      !GOOGLE_ISSUERS.includes(payload.iss) ||
      payload.aud !== clientId ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw invalidToken();
    }

    // Binds the token to the nonce issued to this browser (prevents replay of captured tokens).
    if (!expectedNonce || !payload.nonce || !safeEqual(payload.nonce, expectedNonce)) {
      throw invalidToken();
    }

    if (!payload.email || payload.email_verified !== true) {
      throw new ForbiddenException({
        code: AuthErrorCode.GoogleEmailNotVerified,
        message:
          'Your Google account email address is not verified. Verify it with Google and try again.',
      });
    }

    const email = payload.email.trim().toLowerCase();
    return {
      subject: payload.sub,
      email,
      name: (payload.name ?? email.split('@')[0] ?? 'User').slice(0, 100),
      pictureUrl:
        payload.picture?.startsWith('https://') && payload.picture.length <= 1024
          ? payload.picture
          : undefined,
    };
  }
}
