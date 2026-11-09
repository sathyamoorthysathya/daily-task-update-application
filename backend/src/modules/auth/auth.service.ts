import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditService } from '../../common/monitoring/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { UserProfileDto } from '../users/dto/user-profile.dto.js';
import { toUserProfile, userWithAccounts, type UserWithAccounts } from '../users/users.service.js';
import { AuthErrorCode } from './auth.constants.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.schemas.js';
import type { AuthUser, ClientInfo } from './auth.types.js';
import type { GoogleIdentity } from './google/google-id-token.verifier.js';
import { PasswordService } from './password/password.service.js';
import { type IssuedTokens, TokenService } from './tokens/token.service.js';

export interface AuthResult {
  user: UserProfileDto;
  tokens: IssuedTokens;
}

const emailTaken = () =>
  new ConflictException({
    code: AuthErrorCode.EmailTaken,
    message: 'An account with this email already exists. Sign in instead.',
  });

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, client: ClientInfo): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw emailTaken();
    }

    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: { name: input.name, email: input.email, passwordHash, profile: { create: {} } },
        include: userWithAccounts,
      });
      await this.audit.record({
        event: 'auth.register',
        userId: user.id,
        resourceType: 'user',
        resourceId: user.id,
        details: { method: 'password' },
      });
      return this.startSession(user, client);
    } catch (error) {
      // Concurrent registration with the same email.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw emailTaken();
      }
      throw error;
    }
  }

  async login(input: LoginInput, client: ClientInfo): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: userWithAccounts,
    });

    // Same response (and similar timing) for unknown emails, Google-only accounts and wrong passwords.
    const valid = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !valid) {
      await this.audit.record({
        event: 'auth.login',
        outcome: 'FAILURE',
        userId: user?.id ?? null,
        email: user ? null : input.email,
        details: {
          method: 'password',
          reason: !user ? 'unknown_email' : user.passwordHash ? 'wrong_password' : 'no_password',
        },
      });
      throw new UnauthorizedException({
        code: AuthErrorCode.InvalidCredentials,
        message: 'Invalid email or password.',
      });
    }
    await this.audit.record({
      event: 'auth.login',
      userId: user.id,
      details: { method: 'password' },
    });
    return this.startSession(user, client);
  }

  /**
   * Signs in with a verified Google identity. Accounts are matched by Google's stable `sub`;
   * an existing user with the same (Google-verified) email is linked.
   *
   * Account pre-hijacking protection: if the matching local account never proved ownership of
   * its email, someone else may have registered it. Linking then removes the unverified
   * password and ends all existing sessions, so only the Google account holder keeps access.
   */
  async loginWithGoogle(identity: GoogleIdentity, client: ClientInfo): Promise<AuthResult> {
    // Set inside the transaction: how the Google identity was matched to an account.
    const result: { outcome: 'existing' | 'created' | 'linked' | 'linked_unverified_account' } = {
      outcome: 'existing',
    };
    const user = await this.prisma.$transaction(async (tx) => {
      const account = await tx.authAccount.findUnique({
        where: {
          provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: identity.subject },
        },
      });
      // Informational copy of the Google profile, refreshed on every sign-in.
      const providerProfile = {
        email: identity.email,
        name: identity.name,
        pictureUrl: identity.pictureUrl ?? null,
      };
      if (account) {
        await tx.authAccount.update({
          where: { id: account.id },
          data: { ...providerProfile, lastLoginAt: new Date() },
        });
        return tx.user.findUniqueOrThrow({
          where: { id: account.userId },
          include: userWithAccounts,
        });
      }

      const linkData = {
        provider: 'GOOGLE' as const,
        providerAccountId: identity.subject,
        ...providerProfile,
      };
      const existing = await tx.user.findUnique({ where: { email: identity.email } });

      if (!existing) {
        result.outcome = 'created';
        return tx.user.create({
          data: {
            name: identity.name,
            email: identity.email,
            emailVerifiedAt: new Date(),
            accounts: { create: linkData },
            profile: { create: {} },
          },
          include: userWithAccounts,
        });
      }

      result.outcome = existing.emailVerifiedAt ? 'linked' : 'linked_unverified_account';
      if (!existing.emailVerifiedAt) {
        this.logger.warn(
          `Linking Google to unverified account ${existing.id}: removing password and sessions`,
        );
        await this.tokens.revokeAllForUser(existing.id, tx);
      }
      return tx.user.update({
        where: { id: existing.id },
        data: {
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          ...(existing.emailVerifiedAt ? {} : { passwordHash: null }),
          accounts: { create: linkData },
        },
        include: userWithAccounts,
      });
    });

    // A Google sign-in that removed an unverified password is the pre-hijacking protection.
    await this.audit.record({
      event: result.outcome === 'created' ? 'auth.register' : 'auth.google_login',
      userId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      details: { method: 'google', account: result.outcome },
    });
    return this.startSession(user, client);
  }

  refresh(refreshToken: string, client: ClientInfo): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(
    refreshToken: string | undefined,
    session: { sid: string; sub: string } | undefined,
  ): Promise<void> {
    const sessionId = session?.sid;
    if (refreshToken) {
      await this.tokens.revokeByRefreshToken(refreshToken);
    }
    if (sessionId) {
      await this.tokens.revokeSession(sessionId);
    }
    await this.audit.record({
      event: 'auth.logout',
      userId: session?.sub ?? null,
      resourceType: 'session',
      resourceId: sessionId ?? null,
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({ event: 'auth.logout_all', userId });
  }

  /**
   * Changes the password after re-checking the current one. Other sessions are signed out;
   * the session that made the change stays signed in. Errors are 400s (not 401) because the
   * session itself is valid.
   */
  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!record.passwordHash) {
      throw new BadRequestException({
        code: AuthErrorCode.PasswordNotSet,
        message:
          'Your account signs in with Google and has no password yet. Use "Forgot password" to set one.',
      });
    }
    if (!(await this.passwords.verify(record.passwordHash, input.currentPassword))) {
      await this.audit.record({
        event: 'auth.password_changed',
        outcome: 'FAILURE',
        userId: user.id,
        details: { reason: 'wrong_current_password' },
      });
      throw new BadRequestException({
        code: AuthErrorCode.InvalidCurrentPassword,
        message: 'Current password is incorrect.',
        errors: [{ field: 'currentPassword', message: 'Current password is incorrect.' }],
      });
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException({
        code: AuthErrorCode.PasswordUnchanged,
        message: 'Choose a password different from your current one.',
        errors: [
          { field: 'newPassword', message: 'Choose a password different from your current one.' },
        ],
      });
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, familyId: { not: user.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      event: 'auth.password_changed',
      userId: user.id,
      details: { otherSessionsRevoked: true },
    });
  }

  private async startSession(user: UserWithAccounts, client: ClientInfo): Promise<AuthResult> {
    const tokens = await this.tokens.createSession(user.id, client);
    return { user: toUserProfile(user), tokens };
  }
}
