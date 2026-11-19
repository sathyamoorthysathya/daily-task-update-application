import { Injectable } from '@nestjs/common';
import { describeUserAgent } from '../../../common/http/user-agent.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { ListSecurityEventsQuery, PeriodQuery } from '../admin.schemas.js';
import type { Paged } from '../insights/admin-insights.service.js';
import { daySeries, daysAgo, localDay, periodStart } from '../insights/period-sql.js';

/** Audit events shown under each category of the Security page. */
const CATEGORY_EVENTS = {
  sign_in: [
    'auth.login',
    'auth.google_login',
    'auth.logout',
    'auth.logout_all',
    'auth.session_expired',
    'auth.refresh_token_reuse',
  ],
  account: [
    'auth.register',
    'auth.password_changed',
    'auth.password_reset_requested',
    'auth.password_reset',
    'profile.updated',
    'profile.avatar_changed',
  ],
  access: ['access.denied', 'admin.ip_blocked'],
} as const;

const SIGN_IN_EVENTS = ['auth.login', 'auth.google_login', 'admin.login'];

export interface SecuritySummaryDto {
  period: { days: number; timeZone: string };
  totals: {
    signIns: number;
    failedSignIns: number;
    adminSignIns: number;
    failedAdminSignIns: number;
    adminLockouts: number;
    tokenReuse: number;
    accessDenied: number;
    passwordResets: number;
    disabledUsers: number;
    lockedAdmins: number;
  };
  /** Sign-ins (users and administrators) per day. */
  daily: { date: string; succeeded: number; failed: number }[];
  /** Why sign-ins failed: wrong_password, unknown_email, account_disabled, wrong_code, ... */
  failureReasons: { reason: string; count: number }[];
  /** Addresses with the most failed sign-ins (password guessing shows up here). */
  topFailedIps: { ip: string; failures: number; accounts: number; lastAt: string }[];
  /** Accounts with the most failed sign-ins (someone guessing their password). */
  targetedAccounts: { account: string; failures: number; lastAt: string }[];
}

export interface SecurityEventDto {
  id: string;
  event: string;
  outcome: 'SUCCESS' | 'FAILURE';
  createdAt: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  user: { id: string; name: string; email: string } | null;
  /** Email typed in a failed sign-in of an unknown account. */
  email: string | null;
  admin: { username: string } | null;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
}

/** Security monitoring for administrators: sign-in failures, suspicious addresses, audit log. */
@Injectable()
export class AdminSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async summary({ days, tz }: PeriodQuery): Promise<SecuritySummaryDto> {
    const start = periodStart(days, tz);
    const signInList = Prisma.join(SIGN_IN_EVENTS);
    const [counts, disabledUsers, lockedAdmins, daily, reasons, ips, accounts] = await Promise.all([
      this.prisma.$queryRaw<{ event: string; outcome: string; count: number }[]>`
          SELECT event, outcome::text AS outcome, count(*)::int AS count
          FROM audit_events WHERE created_at >= ${start} GROUP BY 1, 2`,
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
      this.prisma.adminUser.count({ where: { lockedUntil: { gt: new Date() } } }),
      this.prisma.$queryRaw<SecuritySummaryDto['daily']>`
          WITH days AS (${daySeries(days, tz)}),
          attempts AS (
            SELECT ${localDay(Prisma.sql`created_at`, tz)} AS day,
                   count(*) FILTER (WHERE outcome = 'SUCCESS')::int AS succeeded,
                   count(*) FILTER (WHERE outcome = 'FAILURE')::int AS failed
            FROM audit_events
            WHERE created_at >= ${start} AND event IN (${signInList})
            GROUP BY 1
          )
          SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
                 coalesce(attempts.succeeded, 0) AS succeeded,
                 coalesce(attempts.failed, 0) AS failed
          FROM days LEFT JOIN attempts USING (day) ORDER BY days.day`,
      this.prisma.$queryRaw<{ reason: string; count: number }[]>`
          SELECT coalesce(details->>'reason', 'other') AS reason, count(*)::int AS count
          FROM audit_events
          WHERE created_at >= ${start} AND outcome = 'FAILURE' AND event IN (${signInList})
          GROUP BY 1 ORDER BY count DESC, reason`,
      this.prisma.$queryRaw<{ ip: string; failures: number; accounts: number; lastAt: Date }[]>`
          SELECT ip, count(*)::int AS failures,
                 count(DISTINCT coalesce(user_id::text, admin_id::text, email,
                                         details->>'username'))::int AS accounts,
                 max(created_at) AS "lastAt"
          FROM audit_events
          WHERE created_at >= ${start} AND outcome = 'FAILURE' AND event IN (${signInList})
            AND ip IS NOT NULL
          GROUP BY ip ORDER BY failures DESC, "lastAt" DESC LIMIT 8`,
      this.prisma.$queryRaw<{ account: string; failures: number; lastAt: Date }[]>`
          SELECT coalesce(u.email, a.email, 'admin:' || au.username,
                          'admin:' || (a.details->>'username'), 'unknown') AS account,
                 count(*)::int AS failures, max(a.created_at) AS "lastAt"
          FROM audit_events a
          LEFT JOIN users u ON u.id = a.user_id
          LEFT JOIN admin_users au ON au.id = a.admin_id
          WHERE a.created_at >= ${start} AND a.outcome = 'FAILURE' AND a.event IN (${signInList})
          GROUP BY 1 ORDER BY failures DESC, "lastAt" DESC LIMIT 8`,
    ]);

    const count = (events: readonly string[], outcome?: 'SUCCESS' | 'FAILURE') =>
      counts
        .filter((row) => events.includes(row.event) && (!outcome || row.outcome === outcome))
        .reduce((sum, row) => sum + row.count, 0);

    return {
      period: { days, timeZone: tz },
      totals: {
        signIns: count(['auth.login', 'auth.google_login'], 'SUCCESS'),
        failedSignIns: count(['auth.login', 'auth.google_login'], 'FAILURE'),
        adminSignIns: count(['admin.login'], 'SUCCESS'),
        failedAdminSignIns: count(['admin.login'], 'FAILURE'),
        adminLockouts: count(['admin.locked']),
        tokenReuse: count(['auth.refresh_token_reuse']),
        accessDenied: count(CATEGORY_EVENTS.access),
        passwordResets: count(['auth.password_reset_requested']),
        disabledUsers,
        lockedAdmins,
      },
      daily,
      failureReasons: reasons,
      topFailedIps: ips.map((row) => ({ ...row, lastAt: row.lastAt.toISOString() })),
      targetedAccounts: accounts.map((row) => ({ ...row, lastAt: row.lastAt.toISOString() })),
    };
  }

  /** The audit log, newest first, with the users and administrators involved. */
  async events(query: ListSecurityEventsQuery): Promise<Paged<SecurityEventDto>> {
    const category: Prisma.AuditEventWhereInput =
      query.category === 'all'
        ? {}
        : query.category === 'admin'
          ? { event: { startsWith: 'admin.' } }
          : { event: { in: [...CATEGORY_EVENTS[query.category]] } };

    let searchFilter: Prisma.AuditEventWhereInput = {};
    if (query.search) {
      const matchingUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      searchFilter = {
        OR: [
          { event: { contains: query.search, mode: 'insensitive' } },
          { ip: { contains: query.search } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { userId: { in: matchingUsers.map((user) => user.id) } },
        ],
      };
    }

    const where: Prisma.AuditEventWhereInput = {
      AND: [
        { createdAt: { gte: daysAgo(query.days) } },
        category,
        query.outcome ? { outcome: query.outcome } : {},
        searchFilter,
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
    const adminIds = [...new Set(rows.flatMap((row) => (row.adminId ? [row.adminId] : [])))];
    const [users, admins] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.adminUser.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, username: true },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const adminById = new Map(admins.map((admin) => [admin.id, admin]));

    return {
      items: rows.map((row) => {
        const client = row.userAgent ? describeUserAgent(row.userAgent) : null;
        const admin = row.adminId ? adminById.get(row.adminId) : undefined;
        return {
          id: row.id,
          event: row.event,
          outcome: row.outcome,
          createdAt: row.createdAt.toISOString(),
          ip: row.ip,
          browser: client?.browser ?? null,
          os: client?.os ?? null,
          user: (row.userId && userById.get(row.userId)) || null,
          email: row.email,
          admin: admin ? { username: admin.username } : null,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          details: row.details,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
