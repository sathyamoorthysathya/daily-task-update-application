import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Env } from '../../../config/env.schema.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { lockKeys, WorkbookLockService } from '../workbook-lock.service.js';
import { WorkbookSyncService } from '../workbook-sync.service.js';
import { AlertService } from '../../../common/monitoring/alert.service.js';
import { retryDelayMs } from './backoff.js';
import { describeSyncError } from './sync-error.js';

/** A job claimed by this worker (status PROCESSING, attempts already incremented). */
export interface ClaimedJob {
  id: string;
  workbookId: string;
  userId: string;
  taskId: string | null;
  reason: string;
  attempts: number;
  maxAttempts: number;
  targetDataVersion: number;
}

export interface DrainResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/** Reasons that rebuild the file even if its metadata says it is current. */
const FORCE_REBUILD = new Set(['MANUAL', 'RECOVERY']);

/**
 * Processes the Excel synchronisation outbox in the background.
 *
 * - Claiming: `FOR UPDATE SKIP LOCKED` hands each due job to exactly one worker, across any
 *   number of processes. A job left PROCESSING longer than EXCEL_SYNC_LEASE_MS (crashed
 *   worker) is claimed again.
 * - Writing: under the workbook's advisory lock, so one workbook has one writer at a time;
 *   different workbooks (and users) are processed in parallel up to EXCEL_SYNC_CONCURRENCY.
 * - Failures: retried with exponential backoff; after EXCEL_SYNC_MAX_ATTEMPTS the job is DEAD,
 *   the workbook shows the error and an alert is raised. Task data is never affected: it was
 *   committed before the job was processed.
 * - Wake-ups: polling every EXCEL_SYNC_POLL_MS, plus `nudge()` right after each change.
 */
@Injectable()
export class ExcelSyncWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('ExcelSyncWorker');
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly settings: {
    enabled: boolean;
    pollMs: number;
    concurrency: number;
    retryBaseMs: number;
    retryMaxMs: number;
    leaseMs: number;
    maxAttempts: number;
  };
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private filling = false;
  private readonly inFlight = new Set<Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: WorkbookLockService,
    private readonly sync: WorkbookSyncService,
    private readonly alerts: AlertService,
    config: ConfigService<Env, true>,
  ) {
    this.settings = {
      enabled: config.get('EXCEL_SYNC_WORKER_ENABLED', { infer: true }),
      pollMs: config.get('EXCEL_SYNC_POLL_MS', { infer: true }),
      concurrency: config.get('EXCEL_SYNC_CONCURRENCY', { infer: true }),
      retryBaseMs: config.get('EXCEL_SYNC_RETRY_BASE_MS', { infer: true }),
      retryMaxMs: config.get('EXCEL_SYNC_RETRY_MAX_MS', { infer: true }),
      leaseMs: config.get('EXCEL_SYNC_LEASE_MS', { infer: true }),
      maxAttempts: config.get('EXCEL_SYNC_MAX_ATTEMPTS', { infer: true }),
    };
  }

  onApplicationBootstrap(): void {
    if (this.settings.enabled) {
      this.start();
    } else {
      this.logger.log({ event: 'excel_sync.worker_disabled', workerId: this.workerId });
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Starts background processing (startup recovery, polling, wake-ups). */
  start(): void {
    if (this.timer) {
      return;
    }
    this.stopping = false;
    this.timer = setInterval(() => this.nudge(), this.settings.pollMs);
    this.timer.unref();
    this.logger.log({
      event: 'excel_sync.worker_started',
      workerId: this.workerId,
      ...this.settings,
    });
    void this.recoverOrphans()
      .catch((error: unknown) => this.logError('excel_sync.recovery_failed', error))
      .finally(() => this.nudge());
  }

  /** Stops polling and waits for jobs in progress. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const inFlight = this.inFlight.size;
    await Promise.allSettled([...this.inFlight]);
    if (this.settings.enabled) {
      this.logger.log({ event: 'excel_sync.worker_stopped', workerId: this.workerId, inFlight });
    }
  }

  /** Asks the worker to look for due jobs now. Never blocks the caller. */
  nudge(): void {
    if (!this.timer || this.stopping) {
      return;
    }
    setImmediate(() => void this.fill());
  }

  /** Processes every due job now, one after another (tests and operational tooling). */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = { processed: 0, succeeded: 0, failed: 0 };
    for (let job = await this.claim(); job; job = await this.claim()) {
      result.processed += 1;
      if (await this.process(job)) {
        result.succeeded += 1;
      } else {
        result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Creates RECOVERY jobs for workbooks whose file is behind but that have no job that will
   * catch up (e.g. jobs lost before the outbox existed). DEAD jobs are left for a manual
   * resync or the next change.
   */
  async recoverOrphans(): Promise<number> {
    const orphans = await this.prisma.$queryRaw<
      { id: string; user_id: string; data_version: number }[]
    >`
      SELECT w.id, w.user_id, w.data_version
      FROM workbooks w
      WHERE w.synced_version < w.data_version
        AND NOT EXISTS (
          SELECT 1 FROM excel_sync_jobs j
          WHERE j.workbook_id = w.id AND j.status IN ('PENDING', 'PROCESSING', 'FAILED', 'DEAD')
        )`;
    for (const orphan of orphans) {
      await this.prisma.excelSyncJob.create({
        data: {
          workbookId: orphan.id,
          userId: orphan.user_id,
          reason: 'RECOVERY',
          targetDataVersion: orphan.data_version,
          maxAttempts: this.settings.maxAttempts,
        },
      });
    }
    if (orphans.length > 0) {
      this.logger.warn({ event: 'excel_sync.recovery_enqueued', workbooks: orphans.length });
    }
    return orphans.length;
  }

  /** Claims the next due job atomically (or null). */
  async claim(): Promise<ClaimedJob | null> {
    const leaseCutoff = new Date(Date.now() - this.settings.leaseMs);
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE excel_sync_jobs
      SET status = 'PROCESSING', attempts = attempts + 1, locked_at = now(),
          locked_by = ${this.workerId}, updated_at = now()
      WHERE id = (
        SELECT id FROM excel_sync_jobs
        WHERE (status IN ('PENDING', 'FAILED') AND next_attempt_at <= now())
           OR (status = 'PROCESSING' AND locked_at < ${leaseCutoff})
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, workbook_id AS "workbookId", user_id AS "userId", task_id AS "taskId",
                reason::text AS reason, attempts, max_attempts AS "maxAttempts",
                target_data_version AS "targetDataVersion"`;
    return rows[0] ?? null;
  }

  /** Runs one claimed job; returns whether it succeeded. Never throws. */
  async process(job: ClaimedJob): Promise<boolean> {
    const startedAt = Date.now();
    const context = {
      jobId: job.id,
      workbookId: job.workbookId,
      userId: job.userId,
      taskId: job.taskId,
      reason: job.reason,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      workerId: this.workerId,
    };
    try {
      const outcome = await this.locks.withLocks([lockKeys.workbookFile(job.workbookId)], (tx) =>
        this.sync.syncLocked(tx, job.workbookId, {
          jobId: job.id,
          force: FORCE_REBUILD.has(job.reason),
        }),
      );
      this.logger.log({
        event: outcome ? 'excel_sync.job_succeeded' : 'excel_sync.job_skipped_workbook_deleted',
        ...context,
        durationMs: Date.now() - startedAt,
        ...(outcome ?? {}),
      });
      return true;
    } catch (error) {
      await this.fail(job, error, context, Date.now() - startedAt).catch((failError: unknown) =>
        this.logError('excel_sync.failure_not_recorded', failError, context),
      );
      return false;
    }
  }

  private async fill(): Promise<void> {
    if (this.filling) {
      return;
    }
    this.filling = true;
    try {
      while (!this.stopping && this.inFlight.size < this.settings.concurrency) {
        const job = await this.claim();
        if (!job) {
          break;
        }
        const run: Promise<boolean> = this.process(job).finally(() => {
          this.inFlight.delete(run);
          this.nudge();
        });
        this.inFlight.add(run);
      }
    } catch (error) {
      this.logError('excel_sync.claim_failed', error);
    } finally {
      this.filling = false;
    }
  }

  private async fail(
    job: ClaimedJob,
    error: unknown,
    context: Record<string, unknown>,
    durationMs: number,
  ): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    const exhausted = job.attempts >= job.maxAttempts;
    const retryInMs = exhausted
      ? null
      : retryDelayMs(job.attempts, this.settings.retryBaseMs, this.settings.retryMaxMs);

    // Conditional: a concurrent sync may already have completed this job (coalescing).
    const { count } = await this.prisma.excelSyncJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: this.workerId },
      data: exhausted
        ? {
            status: 'DEAD',
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            completedAt: new Date(),
          }
        : {
            status: 'FAILED',
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            nextAttemptAt: new Date(Date.now() + (retryInMs ?? 0)),
          },
    });
    if (count === 0) {
      return;
    }
    // Users see a safe description; the raw error stays in the job, the logs and the alert.
    await this.prisma.workbook.updateMany({
      where: { id: job.workbookId },
      data: { syncError: describeSyncError(error) },
    });

    if (exhausted) {
      this.logger.error({ event: 'excel_sync.job_dead', ...context, durationMs, error: message });
      await this.alerts.raise({
        type: 'excel_sync_failed',
        severity: 'critical',
        message: `Excel synchronisation failed ${job.attempts} times and stopped retrying for workbook ${job.workbookId}.`,
        context: { ...context, error: message },
      });
    } else {
      this.logger.warn({
        event: 'excel_sync.job_failed',
        ...context,
        durationMs,
        error: message,
        retryInMs,
      });
    }
  }

  private logError(event: string, error: unknown, context: Record<string, unknown> = {}): void {
    this.logger.error({
      event,
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
