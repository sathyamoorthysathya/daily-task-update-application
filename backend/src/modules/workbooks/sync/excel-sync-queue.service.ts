import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { ExcelSyncReason, Prisma } from '../../../generated/prisma/client.js';

export type WorkbookSyncState = 'synced' | 'pending' | 'retrying' | 'failed';

export interface SyncJobCounts {
  pending: number;
  processing: number;
  failed: number;
  dead: number;
}

export interface NewSyncJob {
  workbookId: string;
  userId: string;
  reason: ExcelSyncReason;
  taskId?: string;
  /** The workbook's data_version after the change (from the same transaction). */
  targetDataVersion: number;
}

const EMPTY_COUNTS: SyncJobCounts = { pending: 0, processing: 0, failed: 0, dead: 0 };

/**
 * Overall sync state of a workbook:
 * - failed:   a job gave up (retry limit) and nothing has synced the workbook since;
 * - retrying: a job failed and is waiting for its next attempt;
 * - pending:  a change is queued or being written;
 * - synced:   the file contains every saved change.
 */
export function deriveSyncState(
  counts: SyncJobCounts,
  versions: { dataVersion: number; syncedVersion: number },
): WorkbookSyncState {
  if (counts.dead > 0) {
    return 'failed';
  }
  if (counts.failed > 0) {
    return 'retrying';
  }
  if (counts.pending + counts.processing > 0 || versions.syncedVersion < versions.dataVersion) {
    return 'pending';
  }
  return 'synced';
}

/** The Excel synchronisation outbox: jobs are written with the change they describe. */
@Injectable()
export class ExcelSyncQueue {
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('EXCEL_SYNC_MAX_ATTEMPTS', { infer: true });
  }

  /**
   * Adds a job inside the caller's transaction: the job exists if and only if the change was
   * committed (transactional outbox). Returns the job ID.
   */
  async enqueue(tx: Prisma.TransactionClient, job: NewSyncJob): Promise<string> {
    const created = await tx.excelSyncJob.create({
      data: { ...job, maxAttempts: this.maxAttempts },
      select: { id: true },
    });
    return created.id;
  }

  /** Open-job counts per workbook (one grouped query for any number of workbooks). */
  async countsFor(workbookIds: string[]): Promise<Map<string, SyncJobCounts>> {
    const result = new Map<string, SyncJobCounts>();
    if (workbookIds.length === 0) {
      return result;
    }
    const groups = await this.prisma.excelSyncJob.groupBy({
      by: ['workbookId', 'status'],
      where: {
        workbookId: { in: workbookIds },
        status: { in: ['PENDING', 'PROCESSING', 'FAILED', 'DEAD'] },
      },
      _count: { _all: true },
    });
    for (const group of groups) {
      const counts = { ...(result.get(group.workbookId) ?? EMPTY_COUNTS) };
      const key = group.status.toLowerCase() as keyof SyncJobCounts;
      counts[key] = group._count._all;
      result.set(group.workbookId, counts);
    }
    return result;
  }

  countsOrEmpty(counts: Map<string, SyncJobCounts>, workbookId: string): SyncJobCounts {
    return counts.get(workbookId) ?? EMPTY_COUNTS;
  }
}
