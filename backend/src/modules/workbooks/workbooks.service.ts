import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';
import { AuditService } from '../../common/monitoring/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type Workbook } from '../../generated/prisma/client.js';
import type { WorkbookDto, WorkbookListDto, WorkbookSyncStatusDto } from './dto/workbook.dto.js';
import { lockKeys, type LockedTx, WorkbookLockService } from './workbook-lock.service.js';
import {
  sha256Hex,
  WorkbookStorageService,
  workbookStorageKey,
} from './workbook-storage.service.js';
import { WorkbookSyncService } from './workbook-sync.service.js';
import {
  deriveSyncState,
  ExcelSyncQueue,
  type SyncJobCounts,
} from './sync/excel-sync-queue.service.js';
import { ExcelSyncWorker } from './sync/excel-sync.worker.js';
import { WorkbookTemplateService } from './workbook-template.service.js';
import { WorkbookErrorCode } from './workbook.constants.js';
import {
  type CreateWorkbookInput,
  type RenameWorkbookInput,
  workbookNameKey,
} from './workbooks.schemas.js';

export interface WorkbookFile {
  name: string;
  data: Buffer;
}

const notFound = () =>
  new NotFoundException({ code: WorkbookErrorCode.NotFound, message: 'Workbook not found.' });

const nameTaken = () =>
  new ConflictException({
    code: WorkbookErrorCode.NameTaken,
    message: 'You already have a workbook with this name. Choose a different name.',
    errors: [{ field: 'name', message: 'You already have a workbook with this name.' }],
  });

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

function toDto(
  workbook: Workbook,
  defaultWorkbookId: string | null,
  counts: SyncJobCounts,
): WorkbookDto {
  return {
    id: workbook.id,
    name: workbook.name,
    isDefault: workbook.id === defaultWorkbookId,
    taskCount: workbook.taskCount,
    nextTaskNumber: workbook.lastTaskNumber + 1,
    sizeBytes: workbook.sizeBytes,
    syncStatus: deriveSyncState(counts, workbook),
    syncError: counts.dead + counts.failed > 0 ? workbook.syncError : null,
    lastSyncedAt: workbook.lastSyncedAt?.toISOString() ?? null,
    version: workbook.version,
    createdAt: workbook.createdAt.toISOString(),
    updatedAt: workbook.updatedAt.toISOString(),
  };
}

/**
 * Workbook management. Every query is scoped by the authenticated user's ID, and other users'
 * workbooks are reported as "not found" so their IDs are not disclosed.
 */
@Injectable()
export class WorkbooksService {
  private readonly logger = new Logger(WorkbooksService.name);
  private readonly maxPerUser: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: WorkbookStorageService,
    private readonly template: WorkbookTemplateService,
    private readonly locks: WorkbookLockService,
    private readonly sync: WorkbookSyncService,
    private readonly syncQueue: ExcelSyncQueue,
    private readonly syncWorker: ExcelSyncWorker,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.maxPerUser = config.get('MAX_WORKBOOKS_PER_USER', { infer: true });
  }

  async list(userId: string): Promise<WorkbookListDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        defaultWorkbookId: true,
        workbooks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    const counts = await this.syncQueue.countsFor(user.workbooks.map((workbook) => workbook.id));
    return {
      workbooks: user.workbooks.map((workbook) =>
        toDto(workbook, user.defaultWorkbookId, this.syncQueue.countsOrEmpty(counts, workbook.id)),
      ),
      defaultWorkbookId: user.defaultWorkbookId,
      limit: this.maxPerUser,
    };
  }

  async get(userId: string, workbookId: string): Promise<WorkbookDto> {
    const workbook = await this.findOwned(this.prisma, userId, workbookId);
    const counts = await this.syncQueue.countsFor([workbook.id]);
    return toDto(
      workbook,
      await this.defaultIdOf(this.prisma, userId),
      this.syncQueue.countsOrEmpty(counts, workbook.id),
    );
  }

  /** Creates the .xlsx file, then its metadata, as one unit: a failure leaves neither behind. */
  async create(userId: string, input: CreateWorkbookInput): Promise<WorkbookDto> {
    let writtenKey: string | undefined;
    try {
      const created = await this.locks.withLocks([lockKeys.userWorkbooks(userId)], async (tx) => {
        if ((await tx.workbook.count({ where: { userId } })) >= this.maxPerUser) {
          throw new ConflictException({
            code: WorkbookErrorCode.LimitReached,
            message: `You can have up to ${this.maxPerUser} workbooks. Delete one to create another.`,
          });
        }
        const nameKey = workbookNameKey(input.name);
        if (await tx.workbook.findUnique({ where: { userId_nameKey: { userId, nameKey } } })) {
          throw nameTaken();
        }

        const id = randomUUID();
        const storageKey = workbookStorageKey(userId, id);
        const file = await this.storage.write(
          storageKey,
          await this.template.createDailyTasksWorkbook(input.name),
        );
        writtenKey = storageKey;

        const workbook = await tx.workbook.create({
          data: { id, userId, name: input.name, nameKey, storageKey, ...file },
        });
        let defaultId = await this.defaultIdOf(tx, userId);
        if (input.makeDefault || defaultId === null) {
          await tx.user.update({ where: { id: userId }, data: { defaultWorkbookId: id } });
          defaultId = id;
        }
        return toDto(workbook, defaultId, { pending: 0, processing: 0, failed: 0, dead: 0 });
      });
      await this.audit.record({
        event: 'workbook.created',
        userId,
        resourceType: 'workbook',
        resourceId: created.id,
        details: { name: created.name },
      });
      return created;
    } catch (error) {
      if (writtenKey) {
        await this.removeFile(writtenKey);
      }
      throw isUniqueViolation(error) ? nameTaken() : error;
    }
  }

  /** Renames with optimistic locking: fails with 409 if the workbook changed since `version`. */
  async rename(
    userId: string,
    workbookId: string,
    input: RenameWorkbookInput,
  ): Promise<WorkbookDto> {
    let count: number;
    try {
      ({ count } = await this.prisma.workbook.updateMany({
        where: { id: workbookId, userId, version: input.version },
        data: { name: input.name, nameKey: workbookNameKey(input.name), version: { increment: 1 } },
      }));
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken() : error;
    }
    if (count === 0) {
      const current = await this.findOwned(this.prisma, userId, workbookId); // 404 if not owned
      throw new ConflictException({
        code: WorkbookErrorCode.VersionConflict,
        message: 'This workbook was changed elsewhere. Reload and try again.',
        details: { currentVersion: current.version },
      });
    }
    await this.audit.record({
      event: 'workbook.renamed',
      userId,
      resourceType: 'workbook',
      resourceId: workbookId,
      details: { name: input.name },
    });
    return this.get(userId, workbookId);
  }

  async setDefault(userId: string, workbookId: string): Promise<WorkbookListDto> {
    await this.locks.withLocks([lockKeys.userWorkbooks(userId)], async (tx) => {
      await this.findOwned(tx, userId, workbookId);
      await tx.user.update({ where: { id: userId }, data: { defaultWorkbookId: workbookId } });
    });
    return this.list(userId);
  }

  /**
   * Deletes a workbook. The metadata is removed first (in a transaction holding the workbook's
   * lock, so no write is in progress); the file is removed after the commit. If the default
   * workbook is deleted, the oldest remaining workbook becomes the default.
   */
  async remove(userId: string, workbookId: string, expectedVersion?: number): Promise<void> {
    await this.findOwned(this.prisma, userId, workbookId);
    const deleted = await this.locks.withLocks(
      [lockKeys.userWorkbooks(userId), lockKeys.workbookFile(workbookId)],
      async (tx) => {
        const workbook = await this.findOwned(tx, userId, workbookId);
        if (expectedVersion !== undefined && workbook.version !== expectedVersion) {
          throw new ConflictException({
            code: WorkbookErrorCode.VersionConflict,
            message: 'This workbook was changed elsewhere. Reload and try again.',
            details: { currentVersion: workbook.version },
          });
        }
        // The default_workbook_id foreign key is cleared automatically (ON DELETE SET NULL).
        await tx.workbook.delete({ where: { id: workbook.id } });
        if ((await this.defaultIdOf(tx, userId)) === null) {
          const next = await tx.workbook.findFirst({
            where: { userId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true },
          });
          if (next) {
            await tx.user.update({ where: { id: userId }, data: { defaultWorkbookId: next.id } });
          }
        }
        return workbook;
      },
    );
    await this.removeFile(deleted.storageKey);
    // The workbook's tasks and their history are deleted with it: this record remains.
    await this.audit.record({
      event: 'workbook.deleted',
      userId,
      resourceType: 'workbook',
      resourceId: deleted.id,
      details: {
        name: deleted.name,
        taskCount: deleted.taskCount,
        lastTaskNumber: deleted.lastTaskNumber,
      },
    });
  }

  /**
   * Manual resynchronisation: queues a job that rebuilds the file from the database (also
   * resolving failed or dead jobs). Processed asynchronously; returns the sync status.
   */
  async resync(userId: string, workbookId: string): Promise<WorkbookSyncStatusDto> {
    const workbook = await this.findOwned(this.prisma, userId, workbookId);
    await this.syncQueue.enqueue(this.prisma, {
      workbookId,
      userId,
      reason: 'MANUAL',
      targetDataVersion: workbook.dataVersion,
    });
    this.logger.log({ event: 'excel_sync.manual_resync_requested', workbookId, userId });
    await this.audit.record({
      event: 'workbook.resync_requested',
      userId,
      resourceType: 'workbook',
      resourceId: workbookId,
    });
    this.syncWorker.nudge();
    return this.syncStatus(userId, workbookId);
  }

  /** Detailed Excel synchronisation status of one workbook. */
  async syncStatus(userId: string, workbookId: string): Promise<WorkbookSyncStatusDto> {
    const workbook = await this.findOwned(this.prisma, userId, workbookId);
    const [counts, nextRetry] = await Promise.all([
      this.syncQueue.countsFor([workbookId]),
      this.prisma.excelSyncJob.findFirst({
        where: { workbookId, status: 'FAILED' },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      }),
    ]);
    const jobCounts = this.syncQueue.countsOrEmpty(counts, workbookId);
    return {
      workbookId,
      state: deriveSyncState(jobCounts, workbook),
      dataVersion: workbook.dataVersion,
      syncedVersion: workbook.syncedVersion,
      lastSyncedAt: workbook.lastSyncedAt?.toISOString() ?? null,
      pendingJobs: jobCounts.pending + jobCounts.processing,
      retryingJobs: jobCounts.failed,
      failedJobs: jobCounts.dead,
      nextRetryAt: nextRetry?.nextAttemptAt.toISOString() ?? null,
      // User-safe description (raw errors stay in the job record and the logs).
      lastError: jobCounts.failed + jobCounts.dead > 0 ? workbook.syncError : null,
    };
  }

  /**
   * Reads the file under the workbook lock (no write in progress) and verifies its checksum.
   * A stale, missing or modified file is rebuilt from the database (the source of truth)
   * before it is served; a file that still fails verification is never served.
   */
  async download(userId: string, workbookId: string): Promise<WorkbookFile> {
    await this.findOwned(this.prisma, userId, workbookId);
    return this.locks.withLocks([lockKeys.workbookFile(workbookId)], async (tx) => {
      let workbook = await this.findOwned(tx, userId, workbookId);
      let data = await this.readVerified(workbook);
      if (!data || workbook.syncedVersion < workbook.dataVersion) {
        if (data === null) {
          this.logger.warn(
            `Workbook file for ${workbook.id} was missing or modified; rebuilding it`,
          );
        }
        await this.sync.syncLocked(tx, workbook.id, { force: true });
        workbook = await this.findOwned(tx, userId, workbookId);
        data = await this.readVerified(workbook);
      }
      if (!data) {
        this.logger.error(`Workbook file for ${workbook.id} failed verification after a rebuild`);
        throw this.fileUnavailable();
      }
      return { name: workbook.name, data };
    });
  }

  /** The file contents if present and matching the stored checksum, otherwise null. */
  private async readVerified(workbook: Workbook): Promise<Buffer | null> {
    try {
      const data = await this.storage.read(workbook.storageKey);
      return sha256Hex(data) === workbook.sha256 ? data : null;
    } catch {
      return null;
    }
  }

  private async findOwned(db: LockedTx, userId: string, workbookId: string): Promise<Workbook> {
    const workbook = await db.workbook.findFirst({ where: { id: workbookId, userId } });
    if (!workbook) {
      throw notFound();
    }
    return workbook;
  }

  private async defaultIdOf(db: LockedTx, userId: string): Promise<string | null> {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { defaultWorkbookId: true },
    });
    return user.defaultWorkbookId;
  }

  private async removeFile(storageKey: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error) {
      // The metadata is the source of truth; an orphaned file is unreachable through the API.
      this.logger.error(`Could not remove workbook file ${storageKey}`, error);
    }
  }

  private fileUnavailable() {
    return new InternalServerErrorException({
      code: WorkbookErrorCode.FileUnavailable,
      message: 'The workbook file is unavailable. Please contact support.',
    });
  }
}
