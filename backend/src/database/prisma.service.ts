import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Application-wide Prisma client backed by the `pg` driver adapter.
 * Inject this service wherever database access is required.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      // The adapter sends timestamps as UTC wall-clock text without an offset. Pin the session
      // time zone to UTC so PostgreSQL stores them as the correct instant (otherwise a server
      // in e.g. Asia/Kolkata shifts every value) and comparisons with now() are correct.
      options: '-c TimeZone=UTC',
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma client initialised');
  }

  /**
   * Closes the pool last: Nest runs onModuleDestroy before the Excel worker has stopped and
   * before the HTTP server has finished in-flight requests, which still need the database.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connections closed');
  }
}
