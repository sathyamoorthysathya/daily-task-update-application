import { Injectable } from '@nestjs/common';
import type { LockedTx } from './workbook-lock.service.js';
import { WorkbookStorageService } from './workbook-storage.service.js';
import { WorkbookTemplateService } from './workbook-template.service.js';

export interface SyncOutcome {
  /** The file was (re)written. */
  wrote: boolean;
  /** Data rows in the file. */
  rows: number;
  /** data_version the file now contains. */
  syncedVersion: number;
  /** Other open jobs completed by this sync (coalescing). */
  coalescedJobs: number;
}

const OPEN_JOB_STATUSES = ['PENDING', 'PROCESSING', 'FAILED', 'DEAD'] as const;

/**
 * Writes a workbook's .xlsx file from PostgreSQL, the source of truth.
 *
 * The "Daily Tasks" sheet is rebuilt from the database: one row per task update, identified by
 * hidden task / task-update ID columns, so a sync can never duplicate rows and running it again
 * is harmless. Must run inside `WorkbookLockService.withLocks` holding the workbook's file lock,
 * which guarantees a single writer per workbook across workers and API instances.
 */
@Injectable()
export class WorkbookSyncService {
  constructor(
    private readonly storage: WorkbookStorageService,
    private readonly template: WorkbookTemplateService,
  ) {}

  /**
   * Brings the file up to the workbook's current data_version (or rebuilds it regardless with
   * `force`), then marks every open sync job that this version covers as succeeded.
   * Returns null if the workbook no longer exists.
   */
  async syncLocked(
    tx: LockedTx,
    workbookId: string,
    options: { force?: boolean; jobId?: string } = {},
  ): Promise<SyncOutcome | null> {
    const workbook = await tx.workbook.findUnique({ where: { id: workbookId } });
    if (!workbook) {
      return null;
    }

    let wrote = false;
    let rows = 0;
    if (options.force || workbook.syncedVersion < workbook.dataVersion) {
      const updates = await tx.taskUpdate.findMany({
        // Deleted tasks keep their rows in the database (audit) but leave the Excel file.
        where: { task: { workbookId, deletedAt: null } },
        select: {
          id: true,
          entryDate: true,
          status: true,
          description: true,
          reference: true,
          startTime: true,
          endTime: true,
          remarks: true,
          task: {
            select: {
              id: true,
              taskNumber: true,
              name: true,
              project: true,
              assignedBy: true,
              priority: true,
              dueDate: true,
            },
          },
        },
        orderBy: [{ entryDate: 'asc' }, { task: { taskNumber: 'asc' } }, { createdAt: 'asc' }],
      });

      const file = await this.template.createDailyTasksWorkbook(
        workbook.name,
        updates.map((update) => ({
          taskId: update.task.id,
          taskUpdateId: update.id,
          taskNumber: update.task.taskNumber,
          date: update.entryDate,
          taskName: update.task.name,
          description: update.description,
          reference: update.reference,
          status: update.status,
          project: update.task.project,
          assignedBy: update.task.assignedBy,
          priority: update.task.priority,
          dueDate: update.task.dueDate,
          startTime: update.startTime,
          endTime: update.endTime,
          remarks: update.remarks,
        })),
      );
      const stored = await this.storage.write(workbook.storageKey, file);
      await tx.workbook.update({
        where: { id: workbookId },
        data: {
          ...stored,
          // Everything up to the version read above is now in the file.
          syncedVersion: workbook.dataVersion,
          lastSyncedAt: new Date(),
          syncError: null,
        },
      });
      wrote = true;
      rows = updates.length;
    }

    const now = new Date();
    const covered = {
      workbookId,
      status: { in: [...OPEN_JOB_STATUSES] },
      targetDataVersion: { lte: workbook.dataVersion },
    };
    if (options.jobId) {
      await tx.excelSyncJob.updateMany({
        where: { ...covered, id: options.jobId },
        data: { status: 'SUCCEEDED', completedAt: now, lockedAt: null, lockedBy: null },
      });
    }
    const { count } = await tx.excelSyncJob.updateMany({
      where: { ...covered, ...(options.jobId ? { id: { not: options.jobId } } : {}) },
      data: {
        status: 'SUCCEEDED',
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        resolvedByJobId: options.jobId ?? null,
      },
    });

    return { wrote, rows, syncedVersion: workbook.dataVersion, coalescedJobs: count };
  }
}
