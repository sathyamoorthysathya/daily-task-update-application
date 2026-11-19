import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockList, isIP } from 'node:net';
import { describeUserAgent } from '../../../common/http/user-agent.js';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import type { Env } from '../../../config/env.schema.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { ClientInfo } from '../../auth/auth.types.js';
import { generateOpaqueToken, sha256 } from '../../auth/crypto/token-crypto.js';
import { PasswordService } from '../../auth/password/password.service.js';
import { adminPasswordProblem } from '../admin-policy.js';
import { AdminErrorCode, type AdminIdentity, TOTP_ISSUER } from '../admin.constants.js';
import type { AdminChangePasswordInput, AdminLoginInput } from '../admin.schemas.js';
import { SecretBox } from './secret-box.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

const MINUTE_MS = 60_000;
/** lastSeenAt is written at most this often (idle timeout precision vs. one write per request). */
const TOUCH_INTERVAL_MS = MINUTE_MS;

export interface AdminProfileDto {
  id: string;
  username: string;
  displayName: string;
  twoFactorEnabled: boolean;
  passwordChangedAt: string;
  createdAt: string;
  /** The sign-in before the current one (so an administrator notices one that was not theirs). */
  previousSignIn: { at: string; ip: string | null; browser: string; os: string } | null;
  session: { expiresAt: string; idleTimeoutMinutes: number };
}

export interface AdminSessionDto {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  browser: string;
  os: string;
}

export interface AdminAccountDto {
  username: string;
  displayName: string;
  twoFactorEnabled: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** 429 for a locked account; the controller copies `retryAfterSeconds` into Retry-After. */
export class AdminLockedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      {
        code: AdminErrorCode.AccountLocked,
        message: `Too many failed sign-in attempts. This account is locked for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

const invalidCredentials = () =>
  new UnauthorizedException({
    code: AdminErrorCode.InvalidCredentials,
    message: 'Invalid username or password.',
  });

const sessionEnded = () =>
  new UnauthorizedException({
    code: AdminErrorCode.SessionExpired,
    message: 'Your admin session has ended. Please sign in again.',
  });

/**
 * Administrator accounts and admin panel sessions.
 * - Sign-in with a unique username and password (Argon2id), plus a TOTP code when two-step
 *   verification is on. Consecutive failures lock the account (ADMIN_LOCKOUT_*).
 * - Sessions are opaque random tokens (SHA-256 stored), revocable, with an idle timeout and an
 *   absolute lifetime.
 * - Every sign-in, failure, lockout and change is written to the audit log.
 */
@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly lockoutThreshold: number;
  private readonly lockoutMs: number;
  private readonly allowList: BlockList | null;
  private readonly secrets: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.idleMs = config.get('ADMIN_SESSION_IDLE_MINUTES', { infer: true }) * MINUTE_MS;
    this.maxMs = config.get('ADMIN_SESSION_MAX_HOURS', { infer: true }) * 60 * MINUTE_MS;
    this.lockoutThreshold = config.get('ADMIN_LOCKOUT_THRESHOLD', { infer: true });
    this.lockoutMs = config.get('ADMIN_LOCKOUT_MINUTES', { infer: true }) * MINUTE_MS;
    this.allowList = buildAllowList(config.get('ADMIN_ALLOWED_IPS', { infer: true }));
    this.secrets = new SecretBox(config.get('JWT_ACCESS_SECRET', { infer: true }), 'admin-totp');
  }

  get sessionMaxMs(): number {
    return this.maxMs;
  }

  /** Creates the administrator named in ADMIN_USERNAME / ADMIN_PASSWORD if it does not exist. */
  async onApplicationBootstrap(): Promise<void> {
    const username = this.config.get('ADMIN_USERNAME', { infer: true });
    const password = this.config.get('ADMIN_PASSWORD', { infer: true });
    if (!username || !password) {
      return;
    }
    const normalized = username.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findUnique({
      where: { username: normalized },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    try {
      await this.createAdmin(normalized, normalized, password, 'environment');
      this.logger.log(
        `Administrator "${normalized}" created from ADMIN_USERNAME. Remove ADMIN_PASSWORD from the environment now.`,
      );
    } catch (error) {
      // Another instance created it at the same time.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }

  /** Used at start-up and by the admin CLI. The password must meet the admin policy. */
  async createAdmin(
    username: string,
    displayName: string,
    password: string,
    source: 'environment' | 'cli',
  ): Promise<{ id: string; username: string }> {
    const problem = adminPasswordProblem(password, username);
    if (problem) {
      throw new Error(problem);
    }
    const admin = await this.prisma.adminUser.create({
      data: {
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || username,
        passwordHash: await this.passwords.hash(password),
      },
      select: { id: true, username: true },
    });
    await this.audit.record({
      event: 'admin.created',
      adminId: admin.id,
      resourceType: 'admin',
      resourceId: admin.id,
      details: { username: admin.username, source },
    });
    return admin;
  }

  /**
   * Recovery (admin CLI): sets a new password, unlocks the account, turns two-step
   * verification off and ends every session.
   */
  async resetAdmin(username: string, password: string): Promise<void> {
    const normalized = username.trim().toLowerCase();
    const problem = adminPasswordProblem(password, normalized);
    if (problem) {
      throw new Error(problem);
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { username: normalized } });
    if (!admin) {
      throw new Error(`No administrator named "${normalized}"`);
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          totpSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
        },
      }),
      this.prisma.adminSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      event: 'admin.password_changed',
      adminId: admin.id,
      resourceType: 'admin',
      resourceId: admin.id,
      details: { source: 'cli', twoFactorReset: true, sessionsRevoked: true },
    });
  }

  isIpAllowed(ip: string | undefined): boolean {
    if (!this.allowList) {
      return true;
    }
    const address = normalizeIp(ip);
    const version = isIP(address);
    return version !== 0 && this.allowList.check(address, version === 6 ? 'ipv6' : 'ipv4');
  }

  async login(
    input: AdminLoginInput,
    client: ClientInfo,
  ): Promise<{ token: string; profile: AdminProfileDto }> {
    const now = Date.now();
    const admin = await this.prisma.adminUser.findUnique({ where: { username: input.username } });

    if (admin?.lockedUntil && admin.lockedUntil.getTime() > now) {
      await this.audit.record({
        event: 'admin.login',
        outcome: 'FAILURE',
        adminId: admin.id,
        details: { reason: 'locked' },
      });
      throw new AdminLockedException(Math.ceil((admin.lockedUntil.getTime() - now) / 1000));
    }

    // Same answer (and similar timing) for an unknown username and a wrong password.
    const valid = admin
      ? await this.passwords.verify(admin.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!admin || !valid) {
      await this.recordFailure(admin?.id ?? null, admin ? 'wrong_password' : 'unknown_username', {
        username: admin ? null : input.username,
      });
      throw invalidCredentials();
    }

    if (admin.totpEnabledAt && admin.totpSecret) {
      if (!input.code) {
        // Correct password; the second step is still needed (not a failure).
        throw new UnauthorizedException({
          code: AdminErrorCode.TwoFactorRequired,
          message: 'Enter the 6-digit code from your authenticator app.',
        });
      }
      const step = verifyTotp(this.openSecret(admin.totpSecret), input.code, admin.totpLastStep);
      // The conditional update accepts each code once, even for simultaneous requests.
      const accepted =
        step !== null &&
        (
          await this.prisma.adminUser.updateMany({
            where: {
              id: admin.id,
              OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
            },
            data: { totpLastStep: step },
          })
        ).count === 1;
      if (!accepted) {
        await this.recordFailure(admin.id, 'wrong_code');
        throw new UnauthorizedException({
          code: AdminErrorCode.TwoFactorInvalid,
          message: 'That code is not valid. Enter the current code from your authenticator app.',
          errors: [{ field: 'code', message: 'That code is not valid' }],
        });
      }
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(now),
        lastLoginIp: client.ipAddress?.slice(0, 64) ?? null,
      },
    });
    const { token, session } = await this.createSession(admin.id, client);
    await this.audit.record({
      event: 'admin.login',
      adminId: admin.id,
      resourceType: 'session',
      resourceId: session.id,
      details: { twoFactor: admin.totpEnabledAt !== null },
    });
    return {
      token,
      profile: await this.getProfile({
        id: admin.id,
        username: admin.username,
        sessionId: session.id,
      }),
    };
  }

  /** Resolves a session cookie to its administrator, or throws 401. Refreshes the idle timer. */
  async authenticate(token: string): Promise<AdminIdentity> {
    const now = Date.now();
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { admin: { select: { id: true, username: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) {
      throw sessionEnded();
    }
    if (session.lastSeenAt.getTime() + this.idleMs <= now) {
      await this.prisma.adminSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(now) },
      });
      throw sessionEnded();
    }
    if (now - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.prisma.adminSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return { id: session.admin.id, username: session.admin.username, sessionId: session.id };
  }

  async logout(admin: AdminIdentity): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: admin.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      event: 'admin.logout',
      adminId: admin.id,
      resourceType: 'session',
      resourceId: admin.sessionId,
    });
  }

  /** Revokes a session token without an authenticated identity (sign-out with a stale cookie). */
  async revokeToken(token: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(identity: AdminIdentity): Promise<AdminProfileDto> {
    const [admin, session, signIns] = await Promise.all([
      this.prisma.adminUser.findUniqueOrThrow({ where: { id: identity.id } }),
      this.prisma.adminSession.findUniqueOrThrow({ where: { id: identity.sessionId } }),
      this.prisma.auditEvent.findMany({
        where: { adminId: identity.id, event: 'admin.login', outcome: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { createdAt: true, ip: true, userAgent: true, resourceId: true },
      }),
    ]);
    const previous = signIns.find((event) => event.resourceId !== identity.sessionId);
    const client = previous ? describeUserAgent(previous.userAgent) : null;
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      twoFactorEnabled: admin.totpEnabledAt !== null,
      passwordChangedAt: admin.passwordChangedAt.toISOString(),
      createdAt: admin.createdAt.toISOString(),
      previousSignIn:
        previous && client
          ? {
              at: previous.createdAt.toISOString(),
              ip: previous.ip,
              browser: client.browser,
              os: client.os,
            }
          : null,
      session: {
        expiresAt: session.expiresAt.toISOString(),
        idleTimeoutMinutes: this.idleMs / MINUTE_MS,
      },
    };
  }

  async listSessions(identity: AdminIdentity): Promise<AdminSessionDto[]> {
    const now = Date.now();
    const sessions = await this.prisma.adminSession.findMany({
      where: {
        adminId: identity.id,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastSeenAt: { gt: new Date(now - this.idleMs) },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((session) => {
      const client = describeUserAgent(session.userAgent);
      return {
        id: session.id,
        current: session.id === identity.sessionId,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        ip: session.ipAddress,
        browser: client.browser,
        os: client.os,
      };
    });
  }

  async revokeOtherSessions(identity: AdminIdentity): Promise<number> {
    const { count } = await this.prisma.adminSession.updateMany({
      where: { adminId: identity.id, id: { not: identity.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      event: 'admin.logout',
      adminId: identity.id,
      details: { scope: 'other_sessions', count },
    });
    return count;
  }

  async listAdmins(): Promise<AdminAccountDto[]> {
    const now = Date.now();
    const admins = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return admins.map((admin) => ({
      username: admin.username,
      displayName: admin.displayName,
      twoFactorEnabled: admin.totpEnabledAt !== null,
      locked: admin.lockedUntil !== null && admin.lockedUntil.getTime() > now,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
    }));
  }

  /** Requires the current password; other sessions of this administrator are signed out. */
  async changePassword(identity: AdminIdentity, input: AdminChangePasswordInput): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: identity.id } });
    if (!(await this.passwords.verify(admin.passwordHash, input.currentPassword))) {
      await this.audit.record({
        event: 'admin.password_changed',
        outcome: 'FAILURE',
        adminId: admin.id,
        details: { reason: 'wrong_current_password' },
      });
      throw new UnprocessableEntityException({
        code: AdminErrorCode.InvalidCurrentPassword,
        message: 'Current password is incorrect.',
        errors: [{ field: 'currentPassword', message: 'Current password is incorrect.' }],
      });
    }
    const problem =
      input.currentPassword === input.newPassword
        ? 'Choose a password different from your current one.'
        : adminPasswordProblem(input.newPassword, admin.username);
    if (problem) {
      throw new UnprocessableEntityException({
        code: AdminErrorCode.PasswordUnchanged,
        message: problem,
        errors: [{ field: 'newPassword', message: problem }],
      });
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      this.prisma.adminSession.updateMany({
        where: { adminId: admin.id, id: { not: identity.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      event: 'admin.password_changed',
      adminId: admin.id,
      details: { otherSessionsRevoked: true },
    });
  }

  /** Step 1 of turning on two-step verification: a new secret for the authenticator app. */
  async startTwoFactorSetup(
    identity: AdminIdentity,
    password: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: identity.id } });
    await this.requirePassword(admin.passwordHash, password);
    if (admin.totpEnabledAt) {
      throw new ConflictException({
        code: AdminErrorCode.TwoFactorAlreadyEnabled,
        message: 'Two-step verification is already on.',
      });
    }
    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpSecret: this.secrets.seal(secret), totpLastStep: null },
    });
    return { secret, otpauthUri: totpUri(secret, admin.username, TOTP_ISSUER) };
  }

  /** Step 2: a code from the app proves it was set up correctly; from now on it is required. */
  async enableTwoFactor(identity: AdminIdentity, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: identity.id } });
    if (admin.totpEnabledAt) {
      throw new ConflictException({
        code: AdminErrorCode.TwoFactorAlreadyEnabled,
        message: 'Two-step verification is already on.',
      });
    }
    if (!admin.totpSecret) {
      throw new UnprocessableEntityException({
        code: AdminErrorCode.TwoFactorSetupMissing,
        message: 'Start the set-up again.',
      });
    }
    const step = verifyTotp(this.openSecret(admin.totpSecret), code, null);
    if (step === null) {
      throw invalidCode();
    }
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    await this.audit.record({ event: 'admin.two_factor_enabled', adminId: admin.id });
  }

  async disableTwoFactor(identity: AdminIdentity, password: string, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: identity.id } });
    await this.requirePassword(admin.passwordHash, password);
    if (!admin.totpEnabledAt || !admin.totpSecret) {
      throw new ConflictException({
        code: AdminErrorCode.TwoFactorNotEnabled,
        message: 'Two-step verification is not on.',
      });
    }
    if (verifyTotp(this.openSecret(admin.totpSecret), code, admin.totpLastStep) === null) {
      throw invalidCode();
    }
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    });
    await this.audit.record({ event: 'admin.two_factor_disabled', adminId: admin.id });
  }

  private async createSession(adminId: string, client: ClientInfo) {
    const now = Date.now();
    const token = generateOpaqueToken();
    // Housekeeping: sessions that ended long ago are no longer useful.
    await this.prisma.adminSession.deleteMany({
      where: { adminId, expiresAt: { lt: new Date(now - 30 * 24 * 60 * MINUTE_MS) } },
    });
    const session = await this.prisma.adminSession.create({
      data: {
        adminId,
        tokenHash: sha256(token),
        expiresAt: new Date(now + this.maxMs),
        ipAddress: client.ipAddress?.slice(0, 64) ?? null,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });
    return { token, session };
  }

  /** Counts a failed sign-in; the Nth in a row locks the account for ADMIN_LOCKOUT_MINUTES. */
  private async recordFailure(
    adminId: string | null,
    reason: 'unknown_username' | 'wrong_password' | 'wrong_code',
    extra: { username?: string | null } = {},
  ): Promise<void> {
    await this.audit.record({
      event: 'admin.login',
      outcome: 'FAILURE',
      adminId,
      details: { reason, ...(extra.username ? { username: extra.username } : {}) },
    });
    if (!adminId) {
      return;
    }
    const { failedLoginCount } = await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount >= this.lockoutThreshold) {
      await this.prisma.adminUser.update({
        where: { id: adminId },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.lockoutMs) },
      });
      this.logger.warn(`Administrator ${adminId} locked after ${failedLoginCount} failed sign-ins`);
      await this.audit.record({
        event: 'admin.locked',
        outcome: 'FAILURE',
        adminId,
        details: { failedAttempts: failedLoginCount, minutes: this.lockoutMs / MINUTE_MS },
      });
    }
  }

  private async requirePassword(passwordHash: string, password: string): Promise<void> {
    if (!(await this.passwords.verify(passwordHash, password))) {
      throw new UnprocessableEntityException({
        code: AdminErrorCode.InvalidCurrentPassword,
        message: 'Password is incorrect.',
        errors: [{ field: 'password', message: 'Password is incorrect.' }],
      });
    }
  }

  private openSecret(sealed: string): string {
    try {
      return this.secrets.open(sealed);
    } catch {
      // The server secret changed: the stored secret cannot be read (recover with the CLI).
      this.logger.error('An administrator TOTP secret could not be decrypted');
      throw new UnauthorizedException({
        code: AdminErrorCode.TwoFactorInvalid,
        message: 'Two-step verification cannot be checked. Ask another administrator to reset it.',
      });
    }
  }
}

function invalidCode() {
  return new UnprocessableEntityException({
    code: AdminErrorCode.TwoFactorInvalid,
    message: 'That code is not valid. Enter the current code from your authenticator app.',
    errors: [{ field: 'code', message: 'That code is not valid' }],
  });
}

/** "::ffff:203.0.113.7" (IPv4 on a dual-stack socket) is checked as "203.0.113.7". */
function normalizeIp(ip: string | undefined): string {
  const value = ip ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  return mapped?.[1] ?? value;
}

function buildAllowList(entries: string[]): BlockList | null {
  if (entries.length === 0) {
    return null;
  }
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) {
      list.addAddress(address, type);
    } else {
      list.addSubnet(address, Number(prefix), type);
    }
  }
  return list;
}
