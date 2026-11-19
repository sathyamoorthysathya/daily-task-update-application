import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeUserAgent } from '../../common/http/user-agent.js';
import type { Env } from '../../config/env.schema.js';
import { PrismaService } from '../../database/prisma.service.js';
import { normalizePagePath } from './page-path.js';

const DAY_MS = 86_400_000;
/** users.last_seen_at is written at most once a minute per user. */
const LAST_SEEN_PRECISION_MS = 60_000;

export interface PageViewInput {
  path: string;
  visitorId: string;
  userAgent?: string;
  /** Signed-in user, when the request carried a valid access token. */
  userId?: string;
}

/**
 * Product analytics: which pages of the web app are opened, by whom, on which kind of device.
 * Stores the page route (IDs replaced), the user if signed in, and the browser family; no IP
 * addresses, query strings or typed text. Old rows are deleted after PAGE_VIEW_RETENTION_DAYS.
 */
@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly retentionDays: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get('PAGE_VIEW_RETENTION_DAYS', { infer: true });
  }

  onModuleInit(): void {
    // Daily clean-up (and one shortly after start). unref: never keeps the process alive.
    setTimeout(() => void this.deleteExpired(), 60_000).unref();
    this.timer = setInterval(() => void this.deleteExpired(), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Returns false when the visit was not recorded (bot, or not an app page). */
  async recordPageView(input: PageViewInput): Promise<boolean> {
    const path = normalizePagePath(input.path);
    const client = describeUserAgent(input.userAgent);
    if (!path || client.bot) {
      return false;
    }
    const userId = input.userId ?? null;
    const userExists =
      userId !== null &&
      (await this.prisma.user.count({ where: { id: userId, disabledAt: null } })) === 1;
    await this.prisma.pageView.create({
      data: {
        userId: userExists ? userId : null,
        visitorId: input.visitorId,
        path,
        deviceType: client.deviceType,
        browser: client.browser,
        os: client.os,
      },
    });
    if (userExists) {
      const now = Date.now();
      await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: new Date(now - LAST_SEEN_PRECISION_MS) } },
          ],
        },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return true;
  }

  async deleteExpired(): Promise<number> {
    try {
      const { count } = await this.prisma.pageView.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - this.retentionDays * DAY_MS) } },
      });
      if (count > 0) {
        this.logger.log({ event: 'analytics.retention', deleted: count });
      }
      return count;
    } catch (error) {
      this.logger.error({
        event: 'analytics.retention_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
