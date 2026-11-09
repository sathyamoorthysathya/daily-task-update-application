import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { MailService } from '../../mail/mail.service.js';
import { AuthErrorCode } from '../auth.constants.js';
import { generateOpaqueToken, sha256 } from '../crypto/token-crypto.js';
import { PasswordService } from '../password/password.service.js';
import { TokenService } from '../tokens/token.service.js';

const invalidResetToken = () =>
  new BadRequestException({
    code: AuthErrorCode.ResetTokenInvalid,
    message: 'This password reset link is invalid or has expired. Request a new one.',
  });

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly ttlMs: number;
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true }) * 60_000;
    this.frontendUrl = config.get('FRONTEND_URL', { infer: true }).replace(/\/+$/, '');
  }

  /**
   * Starts a password reset. Always resolves without revealing whether the email exists;
   * the email is sent in the background so response times don't differ either.
   */
  async request(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });
    // Recorded for unknown addresses too (same work either way: no enumeration by timing).
    await this.audit.record({
      event: 'auth.password_reset_requested',
      userId: user?.id ?? null,
      email: user ? null : email,
      details: { accountExists: Boolean(user) },
    });
    if (!user) {
      return;
    }

    const token = generateOpaqueToken();
    await this.prisma.$transaction([
      // Only the most recent link is valid.
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + this.ttlMs),
        },
      }),
    ]);

    const link = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const minutes = Math.round(this.ttlMs / 60_000);
    void this.mail
      .send({
        to: user.email,
        subject: 'Reset your Daily Task Update password',
        text:
          `Hi ${user.name},\n\nUse the link below to choose a new password. ` +
          `It expires in ${minutes} minutes and can be used once.\n\n${link}\n\n` +
          `If you didn't request this, you can ignore this email.`,
      })
      .catch((error: unknown) => {
        this.logger.error(`Failed to send password reset email to user ${user.id}`, error);
      });
  }

  /** Sets a new password with a valid, unused reset token and ends all existing sessions. */
  async reset(token: string, newPassword: string): Promise<void> {
    const tokenHash = sha256(token);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      await this.audit.record({
        event: 'auth.password_reset',
        outcome: 'FAILURE',
        userId: record?.userId ?? null,
        details: {
          reason: !record ? 'unknown_token' : record.usedAt ? 'used_token' : 'expired_token',
        },
      });
      throw invalidResetToken();
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Atomic single use: a concurrent second attempt updates nothing.
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (count === 0) {
        throw invalidResetToken();
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: record.userId } });
      await tx.user.update({
        where: { id: user.id },
        // Receiving the email proves ownership of the address.
        data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await this.tokens.revokeAllForUser(user.id, tx);
    });
    await this.audit.record({
      event: 'auth.password_reset',
      userId: record.userId,
      details: { allSessionsRevoked: true },
    });
  }
}
