import { Injectable, NotFoundException } from '@nestjs/common';
import { describeUserAgent } from '../../../common/http/user-agent.js';
import { AuditService } from '../../../common/monitoring/audit.service.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma, TaskStatus } from '../../../generated/prisma/client.js';
import { AdminErrorCode, type AdminIdentity } from '../admin.constants.js';
import type { ListUsersQuery } from '../admin.schemas.js';
import { daysAgo } from '../insights/period-sql.js';
import type { Paged } from '../insights/admin-insights.service.js';

export interface AdminUserRowDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  providers: string[];
  hasPassword: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  workbooks: number;
  tasks: number;
  entries: number;
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  disabledAt: string | null;
  disabledReason: string | null;
  profile: {
    phone: string | null;
    companyName: string | null;
    jobRole: string | null;
    industry: string | null;
    yearsOfExperience: number | null;
  };
  accounts: { provider: string; email: string | null; linkedAt: string; lastLoginAt: string }[];
  tasksByStatus: Record<TaskStatus, number>;
  lastEntryAt: string | null;
  last30Days: { entries: number; views: number };
  workbookList: { id: string; name: string; tasks: number; createdAt: string }[];
  sessions: {
    id: string;
    startedAt: string;
    lastActiveAt: string;
    expiresAt: string;
    ip: string | null;
    browser: string;
    os: string;
    deviceType: string;
  }[];
  topPages: { path: string; views: number }[];
  recentVisits: { id: string; path: string; createdAt: string; browser: string; os: string }[];
  recentEvents: {
    id: string;
    event: string;
    outcome: string;
    createdAt: string;
    ip: string | null;
    details: unknown;
  }[];
}

const STATUSES: TaskStatus[] = ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD'];

const rowInclude = {
  accounts: { select: { provider: true } },
  _count: {
    select: { workbooks: true, tasks: { where: { deletedAt: null } }, taskUpdates: true },
  },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof rowInclude }>;

function toRow(user: UserRow): AdminUserRowDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    providers: user.accounts.map((account) => account.provider.toLowerCase()),
    hasPassword: user.passwordHash !== null,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    workbooks: user._count.workbooks,
    tasks: user._count.tasks,
    entries: user._count.taskUpdates,
  };
}

const notFound = () =>
  new NotFoundException({ code: AdminErrorCode.UserNotFound, message: 'User not found.' });

/** Application users as seen by administrators: list, details, disable/enable, sign-out. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<Paged<AdminUserRowDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.status === 'active'
        ? { disabledAt: null }
        : query.status === 'disabled'
          ? { disabledAt: { not: null } }
          : query.status === 'unverified'
            ? { emailVerifiedAt: null }
            : {}),
    };
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : query.sort === 'name'
          ? [{ name: 'asc' }, { email: 'asc' }]
          : query.sort === 'last_seen'
            ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
            : [{ createdAt: 'desc' }];
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: rowInclude,
      }),
    ]);
    return { items: users.map(toRow), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(userId: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        ...rowInclude,
        profile: true,
        accounts: {
          select: { provider: true, email: true, createdAt: true, lastLoginAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) {
      throw notFound();
    }
    const since = daysAgo(30);
    const [byStatus, lastEntry, entries30, views30, workbooks, sessions, topPages, visits, events] =
      await Promise.all([
        this.prisma.task.groupBy({
          by: ['status'],
          where: { userId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.taskUpdate.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.taskUpdate.count({ where: { userId, createdAt: { gte: since } } }),
        this.prisma.pageView.count({ where: { userId, createdAt: { gte: since } } }),
        this.prisma.workbook.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            createdAt: true,
            _count: { select: { tasks: { where: { deletedAt: null } } } },
          },
        }),
        // The unrevoked token of each session family is its latest rotation.
        this.prisma.refreshToken.findMany({
          where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.pageView.groupBy({
          by: ['path'],
          where: { userId, createdAt: { gte: daysAgo(90) } },
          _count: { _all: true },
          orderBy: { _count: { path: 'desc' } },
          take: 6,
        }),
        this.prisma.pageView.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
        this.prisma.auditEvent.findMany({
          where: { OR: [{ userId }, { resourceType: 'user', resourceId: userId }] },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
      ]);

    const tasksByStatus = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
      TaskStatus,
      number
    >;
    for (const group of byStatus) {
      tasksByStatus[group.status] = group._count._all;
    }

    return {
      ...toRow({ ...user, accounts: user.accounts.map(({ provider }) => ({ provider })) }),
      disabledAt: user.disabledAt?.toISOString() ?? null,
      disabledReason: user.disabledReason,
      profile: {
        phone: user.profile?.phone ?? null,
        companyName: user.profile?.companyName ?? null,
        jobRole: user.profile?.jobRole ?? null,
        industry: user.profile?.industry ?? null,
        yearsOfExperience: user.profile?.yearsOfExperience ?? null,
      },
      accounts: user.accounts.map((account) => ({
        provider: account.provider.toLowerCase(),
        email: account.email,
        linkedAt: account.createdAt.toISOString(),
        lastLoginAt: account.lastLoginAt.toISOString(),
      })),
      tasksByStatus,
      lastEntryAt: lastEntry?.createdAt.toISOString() ?? null,
      last30Days: { entries: entries30, views: views30 },
      workbookList: workbooks.map((workbook) => ({
        id: workbook.id,
        name: workbook.name,
        tasks: workbook._count.tasks,
        createdAt: workbook.createdAt.toISOString(),
      })),
      sessions: sessions.map((session) => {
        const client = describeUserAgent(session.userAgent);
        return {
          id: session.familyId,
          startedAt: session.sessionStartedAt.toISOString(),
          lastActiveAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          ip: session.ipAddress,
          browser: client.browser,
          os: client.os,
          deviceType: client.deviceType,
        };
      }),
      topPages: topPages.map((page) => ({ path: page.path, views: page._count._all })),
      recentVisits: visits.map((visit) => ({
        id: visit.id,
        path: visit.path,
        createdAt: visit.createdAt.toISOString(),
        browser: visit.browser,
        os: visit.os,
      })),
      recentEvents: events.map((event) => ({
        id: event.id,
        event: event.event,
        outcome: event.outcome,
        createdAt: event.createdAt.toISOString(),
        ip: event.ip,
        details: event.details,
      })),
    };
  }

  /** The user can no longer sign in; every session ends immediately. */
  async disable(
    admin: AdminIdentity,
    userId: string,
    reason: string | null,
  ): Promise<AdminUserDetailDto> {
    await this.requireUser(userId);
    const now = new Date();
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { disabledAt: now, disabledReason: reason },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.audit.record({
      event: 'admin.user_disabled',
      adminId: admin.id,
      userId,
      resourceType: 'user',
      resourceId: userId,
      details: { reason, sessionsRevoked: revoked.count },
    });
    return this.detail(userId);
  }

  async enable(admin: AdminIdentity, userId: string): Promise<AdminUserDetailDto> {
    await this.requireUser(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { disabledAt: null, disabledReason: null },
    });
    await this.audit.record({
      event: 'admin.user_enabled',
      adminId: admin.id,
      userId,
      resourceType: 'user',
      resourceId: userId,
    });
    return this.detail(userId);
  }

  /** Ends every session of the user (they can sign in again). */
  async signOutEverywhere(admin: AdminIdentity, userId: string): Promise<{ revoked: number }> {
    await this.requireUser(userId);
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      event: 'admin.user_signed_out',
      adminId: admin.id,
      userId,
      resourceType: 'user',
      resourceId: userId,
      details: { sessions: sessions.length },
    });
    return { revoked: sessions.length };
  }

  private async requireUser(userId: string): Promise<void> {
    if ((await this.prisma.user.count({ where: { id: userId } })) === 0) {
      throw notFound();
    }
  }
}
