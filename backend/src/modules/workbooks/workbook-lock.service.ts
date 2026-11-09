import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { WorkbookErrorCode } from './workbook.constants.js';

export type LockedTx = Prisma.TransactionClient;

/** Lock keys. Acquire user-level locks before workbook-level locks (fixed order, no deadlocks). */
export const lockKeys = {
  /** Serialises changes to a user's set of workbooks (create, delete, default selection). */
  userWorkbooks: (userId: string) => `workbooks:user:${userId}`,
  /** Serialises access to one workbook's file (writes and consistent reads). */
  workbookFile: (workbookId: string) => `workbook:file:${workbookId}`,
};

/**
 * Workbook-level concurrency protection using PostgreSQL transaction-scoped advisory locks.
 * Locks are held until the surrounding transaction ends, are released automatically if the
 * process dies, and work across several API instances sharing the database and storage.
 */
@Injectable()
export class WorkbookLockService {
  constructor(private readonly prisma: PrismaService) {}

  async withLocks<T>(keys: string[], work: (tx: LockedTx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          for (const key of keys) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          }
          return work(tx);
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      // P2028: the transaction could not start in time or exceeded its timeout.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
        throw new ConflictException({
          code: WorkbookErrorCode.Busy,
          message: 'The workbook is busy. Please try again in a moment.',
        });
      }
      throw error;
    }
  }
}
