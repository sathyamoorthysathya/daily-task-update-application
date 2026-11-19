import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { ListVisitsQuery, PeriodQuery } from '../admin.schemas.js';
import { daySeries, daysAgo, localDay, periodStart } from './period-sql.js';

export interface NamedCount {
  name: string;
  views: number;
}

export interface PageStat {
  path: string;
  views: number;
  visitors: number;
  users: number;
}

export interface OverviewDto {
  period: { days: number; timeZone: string };
  users: {
    total: number;
    active: number;
    disabled: number;
    verified: number;
    withGoogle: number;
    withPassword: number;
    newLast7Days: number;
    newLast30Days: number;
    /** Signed in or opened a page within the last 24 hours / 7 days / 30 days. */
    activeLastDay: number;
    activeLast7Days: number;
    activeLast30Days: number;
  };
  content: { workbooks: number; tasks: number; entries: number; activeSessions: number };
  /** One item per day of the period, oldest first. */
  daily: { date: string; signups: number; views: number; visitors: number; entries: number }[];
  topPages: PageStat[];
  devices: NamedCount[];
  recentUsers: { id: string; name: string; email: string; createdAt: string }[];
  topUsers: { id: string; name: string; email: string; entries: number; views: number }[];
  security: {
    failedSignInsLastDay: number;
    failedAdminSignInsLastDay: number;
    lockedAdmins: number;
    tokenReuseLast7Days: number;
  };
}

export interface ActivityDto {
  period: { days: number; timeZone: string };
  totals: {
    views: number;
    visitors: number;
    signedInUsers: number;
    signedOutViews: number;
    viewsPerVisitor: number;
  };
  daily: { date: string; views: number; visitors: number; users: number }[];
  pages: PageStat[];
  devices: NamedCount[];
  browsers: NamedCount[];
  systems: NamedCount[];
  /** Views per hour of the day (0-23, the administrator's time zone). */
  hours: number[];
}

export interface VisitDto {
  id: string;
  path: string;
  createdAt: string;
  deviceType: string;
  browser: string;
  os: string;
  /** Short form of the anonymous browser ID (tells visitors apart without identifying them). */
  visitor: string;
  user: { id: string; name: string; email: string } | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Figures for the Overview and Page visits screens of the admin panel. */
@Injectable()
export class AdminInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview({ days, tz }: PeriodQuery): Promise<OverviewDto> {
    const now = Date.now();
    const user = this.prisma.user;
    const [
      total,
      disabled,
      verified,
      withGoogle,
      withPassword,
      newLast7Days,
      newLast30Days,
      activeLastDay,
      activeLast7Days,
      activeLast30Days,
      workbooks,
      tasks,
      entries,
      activeSessions,
      daily,
      topPages,
      devices,
      recentUsers,
      topUsers,
      security,
    ] = await Promise.all([
      user.count(),
      user.count({ where: { disabledAt: { not: null } } }),
      user.count({ where: { emailVerifiedAt: { not: null } } }),
      user.count({ where: { accounts: { some: { provider: 'GOOGLE' } } } }),
      user.count({ where: { passwordHash: { not: null } } }),
      user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
      user.count({ where: { lastSeenAt: { gte: daysAgo(1) } } }),
      user.count({ where: { lastSeenAt: { gte: daysAgo(7) } } }),
      user.count({ where: { lastSeenAt: { gte: daysAgo(30) } } }),
      this.prisma.workbook.count(),
      this.prisma.task.count({ where: { deletedAt: null } }),
      this.prisma.taskUpdate.count({ where: { task: { deletedAt: null } } }),
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT count(DISTINCT family_id)::int AS count FROM refresh_tokens
        WHERE revoked_at IS NULL AND expires_at > now()`.then((rows) => rows[0]?.count ?? 0),
      this.prisma.$queryRaw<OverviewDto['daily']>`
        WITH days AS (${daySeries(days, tz)}),
        signups AS (
          SELECT ${localDay(Prisma.sql`created_at`, tz)} AS day, count(*)::int AS n
          FROM users WHERE created_at >= ${periodStart(days, tz)} GROUP BY 1
        ),
        views AS (
          SELECT ${localDay(Prisma.sql`created_at`, tz)} AS day, count(*)::int AS n,
                 count(DISTINCT visitor_id)::int AS visitors
          FROM page_views WHERE created_at >= ${periodStart(days, tz)} GROUP BY 1
        ),
        entries AS (
          SELECT ${localDay(Prisma.sql`created_at`, tz)} AS day, count(*)::int AS n
          FROM task_updates WHERE created_at >= ${periodStart(days, tz)} GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
               coalesce(signups.n, 0) AS signups,
               coalesce(views.n, 0) AS views,
               coalesce(views.visitors, 0) AS visitors,
               coalesce(entries.n, 0) AS entries
        FROM days
        LEFT JOIN signups USING (day)
        LEFT JOIN views USING (day)
        LEFT JOIN entries USING (day)
        ORDER BY days.day`,
      this.topPages(days, tz, 8),
      this.countBy('device_type', days, tz),
      user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, email: true, createdAt: true },
      }),
      this.prisma.$queryRaw<OverviewDto['topUsers']>`
        WITH entries AS (
          SELECT user_id, count(*)::int AS n FROM task_updates
          WHERE created_at >= ${periodStart(days, tz)} GROUP BY user_id
        ),
        views AS (
          SELECT user_id, count(*)::int AS n FROM page_views
          WHERE created_at >= ${periodStart(days, tz)} AND user_id IS NOT NULL GROUP BY user_id
        )
        SELECT u.id, u.name, u.email,
               coalesce(entries.n, 0) AS entries, coalesce(views.n, 0) AS views
        FROM users u
        LEFT JOIN entries ON entries.user_id = u.id
        LEFT JOIN views ON views.user_id = u.id
        WHERE entries.n IS NOT NULL OR views.n IS NOT NULL
        ORDER BY coalesce(entries.n, 0) DESC, coalesce(views.n, 0) DESC, u.name
        LIMIT 5`,
      Promise.all([
        this.prisma.auditEvent.count({
          where: {
            event: { in: ['auth.login', 'auth.google_login'] },
            outcome: 'FAILURE',
            createdAt: { gte: daysAgo(1) },
          },
        }),
        this.prisma.auditEvent.count({
          where: { event: 'admin.login', outcome: 'FAILURE', createdAt: { gte: daysAgo(1) } },
        }),
        this.prisma.adminUser.count({ where: { lockedUntil: { gt: new Date(now) } } }),
        this.prisma.auditEvent.count({
          where: { event: 'auth.refresh_token_reuse', createdAt: { gte: daysAgo(7) } },
        }),
      ]),
    ]);

    return {
      period: { days, timeZone: tz },
      users: {
        total,
        active: total - disabled,
        disabled,
        verified,
        withGoogle,
        withPassword,
        newLast7Days,
        newLast30Days,
        activeLastDay,
        activeLast7Days,
        activeLast30Days,
      },
      content: { workbooks, tasks, entries, activeSessions },
      daily,
      topPages,
      devices,
      recentUsers: recentUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
      topUsers,
      security: {
        failedSignInsLastDay: security[0],
        failedAdminSignInsLastDay: security[1],
        lockedAdmins: security[2],
        tokenReuseLast7Days: security[3],
      },
    };
  }

  async activity({ days, tz }: PeriodQuery): Promise<ActivityDto> {
    const [totals, daily, pages, devices, browsers, systems, hours] = await Promise.all([
      this.prisma.$queryRaw<
        { views: number; visitors: number; users: number; signedOut: number }[]
      >`
        SELECT count(*)::int AS views,
               count(DISTINCT visitor_id)::int AS visitors,
               count(DISTINCT user_id)::int AS users,
               count(*) FILTER (WHERE user_id IS NULL)::int AS "signedOut"
        FROM page_views WHERE created_at >= ${periodStart(days, tz)}`,
      this.prisma.$queryRaw<ActivityDto['daily']>`
        WITH days AS (${daySeries(days, tz)}),
        views AS (
          SELECT ${localDay(Prisma.sql`created_at`, tz)} AS day, count(*)::int AS views,
                 count(DISTINCT visitor_id)::int AS visitors,
                 count(DISTINCT user_id)::int AS users
          FROM page_views WHERE created_at >= ${periodStart(days, tz)} GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
               coalesce(views.views, 0) AS views,
               coalesce(views.visitors, 0) AS visitors,
               coalesce(views.users, 0) AS users
        FROM days LEFT JOIN views USING (day) ORDER BY days.day`,
      this.topPages(days, tz, 20),
      this.countBy('device_type', days, tz),
      this.countBy('browser', days, tz),
      this.countBy('os', days, tz),
      this.prisma.$queryRaw<{ hour: number; views: number }[]>`
        SELECT extract(hour FROM created_at AT TIME ZONE ${tz})::int AS hour, count(*)::int AS views
        FROM page_views WHERE created_at >= ${periodStart(days, tz)} GROUP BY 1`,
    ]);
    const total = totals[0] ?? { views: 0, visitors: 0, users: 0, signedOut: 0 };
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const row of hours) {
      byHour[row.hour] = row.views;
    }
    return {
      period: { days, timeZone: tz },
      totals: {
        views: total.views,
        visitors: total.visitors,
        signedInUsers: total.users,
        signedOutViews: total.signedOut,
        viewsPerVisitor:
          total.visitors === 0 ? 0 : Math.round((total.views / total.visitors) * 10) / 10,
      },
      daily,
      pages,
      devices,
      browsers,
      systems,
      hours: byHour,
    };
  }

  /** The visit log, newest first. */
  async visits(query: ListVisitsQuery): Promise<Paged<VisitDto>> {
    const where: Prisma.PageViewWhereInput = {
      createdAt: { gte: daysAgo(query.days) },
      ...(query.path ? { path: query.path } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.audience === 'signed_in'
        ? { userId: query.userId ?? { not: null } }
        : query.audience === 'signed_out'
          ? { userId: null }
          : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.pageView.count({ where }),
      this.prisma.pageView.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        path: row.path,
        createdAt: row.createdAt.toISOString(),
        deviceType: row.deviceType,
        browser: row.browser,
        os: row.os,
        visitor: row.visitorId.slice(-6),
        user: row.user,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private topPages(days: number, tz: string, limit: number): Promise<PageStat[]> {
    return this.prisma.$queryRaw<PageStat[]>`
      SELECT path, count(*)::int AS views,
             count(DISTINCT visitor_id)::int AS visitors,
             count(DISTINCT user_id)::int AS users
      FROM page_views WHERE created_at >= ${periodStart(days, tz)}
      GROUP BY path ORDER BY views DESC, path LIMIT ${limit}::int`;
  }

  /** Views per value of a page_views column (a fixed column name, never user input). */
  private countBy(
    column: 'device_type' | 'browser' | 'os',
    days: number,
    tz: string,
  ): Promise<NamedCount[]> {
    return this.prisma.$queryRaw<NamedCount[]>`
      SELECT ${Prisma.raw(`"${column}"`)} AS name, count(*)::int AS views
      FROM page_views WHERE created_at >= ${periodStart(days, tz)}
      GROUP BY 1 ORDER BY views DESC, name`;
  }
}
