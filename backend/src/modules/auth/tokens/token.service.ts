import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../../config/env.schema.js';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AuthErrorCode } from '../auth.constants.js';
import type { AccessTokenPayload, ClientInfo } from '../auth.types.js';
import { generateOpaqueToken, sha256 } from '../crypto/token-crypto.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
}

type Db = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

function unauthorized(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}

/**
 * Issues and validates tokens.
 * - Access token: short-lived HS256 JWT `{ sub, sid }` (sid = session / refresh token family).
 * - Refresh token: opaque 256-bit random value; only its SHA-256 hash is stored.
 *   Every refresh rotates the token; presenting an already-rotated token revokes the session.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshTtlMs: number;
  private readonly sessionMaxMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * DAY_MS;
    this.sessionMaxMs = config.get('SESSION_MAX_DAYS', { infer: true }) * DAY_MS;
  }

  /** Starts a new login session for the user. */
  async createSession(
    userId: string,
    client: ClientInfo,
    db: Db = this.prisma,
  ): Promise<IssuedTokens> {
    const sessionId = randomUUID();
    // Housekeeping: expired tokens are useless (revoked-but-unexpired ones are kept for reuse detection).
    await db.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    const { token } = await this.createRefreshToken(db, userId, sessionId, new Date(), client);
    return {
      accessToken: await this.signAccessToken({ sub: userId, sid: sessionId }),
      refreshToken: token,
      sessionId,
      userId,
    };
  }

  /** Exchanges a refresh token for a new access + refresh token pair (single use). */
  async rotate(refreshToken: string, client: ClientInfo): Promise<IssuedTokens> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });

    if (!existing) {
      throw unauthorized(
        AuthErrorCode.RefreshTokenInvalid,
        'Your session is invalid. Please sign in again.',
      );
    }
    if (existing.revokedAt) {
      await this.handleReuse(existing.familyId, existing.userId);
    }
    // Absolute lifetime: refreshing never extends a session beyond SESSION_MAX_DAYS.
    if (existing.sessionStartedAt.getTime() + this.sessionMaxMs <= Date.now()) {
      await this.revokeSession(existing.familyId);
      await this.audit.record({
        event: 'auth.session_expired',
        outcome: 'FAILURE',
        userId: existing.userId,
        resourceType: 'session',
        resourceId: existing.familyId,
        details: { reason: 'max_session_age' },
      });
      throw unauthorized(
        AuthErrorCode.RefreshTokenExpired,
        'Your session has expired. Please sign in again.',
      );
    }
    if (existing.expiresAt <= new Date()) {
      throw unauthorized(
        AuthErrorCode.RefreshTokenExpired,
        'Your session has expired. Please sign in again.',
      );
    }

    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update makes rotation atomic: only one concurrent request can win.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        return null;
      }
      const next = await this.createRefreshToken(
        tx,
        existing.userId,
        existing.familyId,
        existing.sessionStartedAt,
        client,
      );
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedById: next.record.id },
      });
      return next.token;
    });

    if (!rotated) {
      await this.handleReuse(existing.familyId, existing.userId);
    }

    return {
      accessToken: await this.signAccessToken({ sub: existing.userId, sid: existing.familyId }),
      refreshToken: rotated as string,
      sessionId: existing.familyId,
      userId: existing.userId,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<Partial<AccessTokenPayload>>(token);
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw new Error('Malformed access token payload');
      }
      return { sub: payload.sub, sid: payload.sid };
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw unauthorized(
          AuthErrorCode.TokenExpired,
          'Your session has expired. Please sign in again.',
        );
      }
      throw unauthorized(
        AuthErrorCode.InvalidToken,
        'Invalid authentication token. Please sign in again.',
      );
    }
  }

  /** A session is active while it has at least one unrevoked, unexpired refresh token. */
  async isSessionActive(userId: string, sessionId: string): Promise<boolean> {
    const count = await this.prisma.refreshToken.count({
      where: { userId, familyId: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return count > 0;
  }

  /** Revokes the session the given refresh token belongs to. Unknown tokens are ignored. */
  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      select: { familyId: true },
    });
    if (existing) {
      await this.revokeSession(existing.familyId);
    }
  }

  async revokeSession(sessionId: string, db: Db = this.prisma): Promise<void> {
    await db.refreshToken.updateMany({
      where: { familyId: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, db: Db = this.prisma): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync({ ...payload });
  }

  private async handleReuse(familyId: string, userId: string): Promise<never> {
    this.logger.warn(`Refresh token reuse detected (user ${userId}); revoking session ${familyId}`);
    await this.revokeSession(familyId);
    await this.audit.record({
      event: 'auth.refresh_token_reuse',
      outcome: 'FAILURE',
      userId,
      resourceType: 'session',
      resourceId: familyId,
      details: { action: 'session_revoked' },
    });
    throw unauthorized(
      AuthErrorCode.RefreshTokenReused,
      'Your session was ended for security reasons. Please sign in again.',
    );
  }

  private async createRefreshToken(
    db: Db,
    userId: string,
    familyId: string,
    sessionStartedAt: Date,
    client: ClientInfo,
  ) {
    const token = generateOpaqueToken();
    const expiresAt = Math.min(
      Date.now() + this.refreshTtlMs,
      sessionStartedAt.getTime() + this.sessionMaxMs,
    );
    const record = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(token),
        expiresAt: new Date(expiresAt),
        sessionStartedAt,
        userAgent: client.userAgent?.slice(0, 512),
        ipAddress: client.ipAddress?.slice(0, 64),
      },
      select: { id: true },
    });
    return { token, record };
  }
}
