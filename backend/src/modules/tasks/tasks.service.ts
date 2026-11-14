import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  type ExcelSyncReason,
  Prisma,
  type Task,
  type TaskHistory,
  type TaskStatus,
  type TaskUpdate,
} from '../../generated/prisma/client.js';
import { TASK_STATUS_VALUES } from './task-status.js';
import { buildReportPdf } from './report-pdf.js';
import { buildReportWorkbook, reportFileName, reportPeriodLabel } from './report-workbook.js';
import { ExcelSyncQueue } from '../workbooks/sync/excel-sync-queue.service.js';
import { ExcelSyncWorker } from '../workbooks/sync/excel-sync.worker.js';
import type {
  DeleteTaskResultDto,
  ExcelSyncDto,
  RecentTaskUpdatesDto,
  SaveTaskResultDto,
  SaveTaskSummaryDto,
  TaskDetailDto,
  TaskDto,
  TaskHistoryDto,
  TaskLookupDto,
  TaskMatchDto,
  TaskPageDto,
  TaskReportDto,
  TaskSummaryDto,
  TaskUpdateDto,
} from './dto/task.dto.js';
import {
  type AddTaskUpdateInput,
  type CreateTaskInput,
  type EditTaskUpdateInput,
  formatCalendarDate,
  type ListTasksQuery,
  type ListTaskUpdatesQuery,
  type LookupTaskQuery,
  parseCalendarDate,
  type RenameTaskInput,
  type ReportDownloadQuery,
  type TaskReportQuery,
  type TaskSummaryQuery,
  taskNameKey,
} from './tasks.schemas.js';

type Db = Prisma.TransactionClient;

/** A committed change and the Excel sync job queued with it. */
interface Saved {
  task: Task;
  update: TaskUpdate;
  jobId: string;
}

interface WorkbookRef {
  id: string;
  name: string;
}

export const TaskErrorCode = {
  NotFound: 'TASK_NOT_FOUND',
  UpdateNotFound: 'TASK_UPDATE_NOT_FOUND',
  AlreadyExists: 'TASK_ALREADY_EXISTS',
  UpdateExistsForDate: 'TASK_UPDATE_EXISTS_FOR_DATE',
  VersionConflict: 'TASK_UPDATE_VERSION_CONFLICT',
  TaskVersionConflict: 'TASK_VERSION_CONFLICT',
  NameTaken: 'TASK_NAME_TAKEN',
  WorkbookNotFound: 'WORKBOOK_NOT_FOUND',
  WorkbookFull: 'WORKBOOK_FULL',
  WorkbookRequired: 'WORKBOOK_SELECTION_REQUIRED',
  NoWorkbook: 'NO_WORKBOOK',
} as const;

function toTaskDto(task: Task): TaskDto {
  return {
    id: task.id,
    workbookId: task.workbookId,
    taskNumber: task.taskNumber,
    name: task.name,
    status: task.status,
    lastEntryDate: formatCalendarDate(task.lastEntryDate),
    entryCount: task.entryCount,
    assignedBy: task.assignedBy,
    priority: task.priority,
    project: task.project,
    dueDate: task.dueDate ? formatCalendarDate(task.dueDate) : null,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
  };
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Minutes between a start and an end time ("HH:MM"); null unless both are set. */
export function minutesBetween(startTime: string | null, endTime: string | null): number | null {
  return startTime && endTime ? toMinutes(endTime) - toMinutes(startTime) : null;
}

/** Most entries a work report returns. */
const REPORT_ENTRY_LIMIT = 2000;

function toUpdateDto(update: TaskUpdate): TaskUpdateDto {
  return {
    id: update.id,
    taskId: update.taskId,
    entryDate: formatCalendarDate(update.entryDate),
    status: update.status,
    description: update.description,
    reference: update.reference,
    startTime: update.startTime,
    endTime: update.endTime,
    minutesWorked: minutesBetween(update.startTime, update.endTime),
    remarks: update.remarks,
    version: update.version,
    createdAt: update.createdAt.toISOString(),
    updatedAt: update.updatedAt.toISOString(),
  };
}

function toHistoryDto(entry: TaskHistory): TaskHistoryDto {
  return {
    id: entry.id,
    action: entry.action,
    taskUpdateId: entry.taskUpdateId,
    changes: entry.changes,
    createdAt: entry.createdAt.toISOString(),
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const latestFirst = [{ entryDate: 'desc' as const }, { createdAt: 'desc' as const }];

/** Task-list orderings; the id makes the order total, so pages never overlap or skip rows. */
const TASK_ORDER: Record<ListTasksQuery['sort'], Prisma.TaskOrderByWithRelationInput[]> = {
  latest: [{ lastEntryDate: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
  oldest: [{ lastEntryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  number: [{ taskNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  name: [{ nameKey: 'asc' }, { id: 'asc' }],
};

/**
 * Search semantics: "#12" finds task number 12 only; "12" finds task number 12 or names
 * containing "12"; anything else searches names (substring, case-insensitive).
 */
function taskSearchFilter(search: string): Prisma.TaskWhereInput {
  const exactNumber = /^#(\d{1,9})$/.exec(search.trim());
  if (exactNumber) {
    return { taskNumber: Number(exactNumber[1]) };
  }
  const byName: Prisma.TaskWhereInput = {
    nameKey: { contains: escapeLike(taskNameKey(search)) },
  };
  return /^\d{1,9}$/.test(search.trim())
    ? { OR: [byName, { taskNumber: Number(search.trim()) }] }
    : byName;
}

/** Prisma passes `contains` to LIKE unescaped: make %, _ and \ match literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const DAY_MS = 86_400_000;

function emptyStatusCounts(): Record<TaskStatus, number> {
  return Object.fromEntries(TASK_STATUS_VALUES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
}

const taskNotFound = () =>
  new NotFoundException({ code: TaskErrorCode.NotFound, message: 'Task not found.' });

/** The Excel file is updated in the background by the job queued with the change. */
const queued = (workbookId: string, jobId: string): ExcelSyncDto => ({
  workbookId,
  status: 'queued',
  jobId,
});

/** Nothing changed, so no Excel job was needed. */
const unchanged = (workbookId: string): ExcelSyncDto => ({
  workbookId,
  status: 'unchanged',
  jobId: null,
});

/**
 * Daily task management. Every query is scoped to the authenticated user; other users' tasks,
 * updates and workbooks are reported as "not found".
 *
 * History is never overwritten silently: a repeated task becomes a new dated update linked to
 * the original task, edits require the update's current version, and every change is recorded
 * in the append-only task_history table.
 *
 * Excel: every change queues an Excel sync job in the same transaction (transactional outbox);
 * the worker writes the file afterwards. The API never waits for Excel, and an Excel failure
 * can never roll back saved task data.
 */
@Injectable()
export class TasksService {
  private readonly maxEntriesPerWorkbook: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncQueue: ExcelSyncQueue,
    private readonly syncWorker: ExcelSyncWorker,
    config: ConfigService<Env, true>,
  ) {
    this.maxEntriesPerWorkbook = config.get('MAX_ENTRIES_PER_WORKBOOK', { infer: true });
  }

  /** Finds an existing task with the same name in the workbook (for the duplicate dialog). */
  async lookup(userId: string, query: LookupTaskQuery): Promise<TaskLookupDto> {
    const workbook = await this.resolveWorkbook(userId, query.workbookId);
    return {
      match: await this.findMatch(this.prisma, workbook, taskNameKey(query.name), query.entryDate),
    };
  }

  /**
   * Creates a task and its first dated update. Fails with 409 TASK_ALREADY_EXISTS (including
   * the existing task) when the workbook already has a task with that name.
   */
  async create(userId: string, input: CreateTaskInput): Promise<SaveTaskResultDto> {
    const workbook = await this.resolveWorkbook(userId, input.workbookId);
    const nameKey = taskNameKey(input.name);
    const entryDate = parseCalendarDate(input.entryDate);

    let saved: Saved;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const existing = await this.findMatch(tx, workbook, nameKey, input.entryDate);
        if (existing) {
          throw this.duplicateTask(existing);
        }
        // Row lock on the workbook: task numbers are handed out one at a time, never reused.
        const { lastTaskNumber, dataVersion } = await tx.workbook.update({
          where: { id: workbook.id },
          data: {
            lastTaskNumber: { increment: 1 },
            taskCount: { increment: 1 },
            dataVersion: { increment: 1 },
          },
          select: { lastTaskNumber: true, dataVersion: true },
        });
        await this.assertCapacity(tx, workbook.id);
        const task = await tx.task.create({
          data: {
            userId,
            workbookId: workbook.id,
            taskNumber: lastTaskNumber,
            name: input.name,
            nameKey,
            status: input.status,
            lastEntryDate: entryDate,
            assignedBy: input.assignedBy,
            priority: input.priority,
            project: input.project,
            dueDate: input.dueDate ? parseCalendarDate(input.dueDate) : null,
          },
        });
        const update = await tx.taskUpdate.create({
          data: {
            taskId: task.id,
            userId,
            entryDate,
            status: input.status,
            description: input.description,
            reference: input.reference,
            startTime: input.startTime,
            endTime: input.endTime,
            remarks: input.remarks,
          },
        });
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            taskUpdateId: update.id,
            userId,
            action: 'TASK_CREATED',
            changes: {
              taskNumber: task.taskNumber,
              name: task.name,
              workbookId: workbook.id,
              assignedBy: input.assignedBy,
              priority: input.priority,
              project: input.project,
              dueDate: input.dueDate,
              entryDate: input.entryDate,
              status: input.status,
              description: input.description,
              reference: input.reference,
              startTime: input.startTime,
              endTime: input.endTime,
              remarks: input.remarks,
            },
          },
        });
        const jobId = await this.syncQueue.enqueue(tx, {
          workbookId: workbook.id,
          userId,
          taskId: task.id,
          reason: 'TASK_CREATED',
          targetDataVersion: dataVersion,
        });
        return { task, update, jobId };
      });
    } catch (error) {
      // A concurrent request created the same task first (unique workbook + name).
      if (isUniqueViolation(error)) {
        const existing = await this.findMatch(this.prisma, workbook, nameKey, input.entryDate);
        if (existing) {
          throw this.duplicateTask(existing);
        }
      }
      throw error;
    }
    return this.afterCommit(saved);
  }

  /** "Create New Daily Task Entry": a new dated update linked to the original task. */
  async addUpdate(
    userId: string,
    taskId: string,
    input: AddTaskUpdateInput,
  ): Promise<SaveTaskResultDto> {
    const task = await this.findOwnedTask(this.prisma, userId, taskId);
    const entryDate = parseCalendarDate(input.entryDate);

    let saved: Saved;
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const dataVersion = await this.lockForChange(tx, task);
        await this.assertCapacity(tx, task.workbookId);
        await tx.task.update({ where: { id: task.id }, data: { entryCount: { increment: 1 } } });
        const update = await tx.taskUpdate.create({
          data: {
            taskId: task.id,
            userId,
            entryDate,
            status: input.status,
            description: input.description,
            reference: input.reference,
            startTime: input.startTime,
            endTime: input.endTime,
            remarks: input.remarks,
          },
        });
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            taskUpdateId: update.id,
            userId,
            action: 'ENTRY_ADDED',
            changes: {
              entryDate: input.entryDate,
              status: input.status,
              description: input.description,
              reference: input.reference,
              startTime: input.startTime,
              endTime: input.endTime,
              remarks: input.remarks,
            },
          },
        });
        const jobId = await this.enqueueFor(tx, task, 'ENTRY_ADDED', dataVersion);
        return { task: await this.refreshSummary(tx, task.id), update, jobId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const onDate = await this.prisma.taskUpdate.findUnique({
          where: { taskId_entryDate: { taskId: task.id, entryDate } },
        });
        throw new ConflictException({
          code: TaskErrorCode.UpdateExistsForDate,
          message: `This task already has an entry for ${input.entryDate}. Update that entry instead.`,
          details: onDate ? { existingUpdate: toUpdateDto(onDate) } : undefined,
        });
      }
      throw error;
    }
    return this.afterCommit(saved);
  }

  /**
   * "Update Existing Task": edits one dated update (status, description, reference, working
   * hours, remarks).
   * Requires the version the client saw; the previous values are kept in task_history.
   */
  async editUpdate(
    userId: string,
    taskId: string,
    updateId: string,
    input: EditTaskUpdateInput,
  ): Promise<SaveTaskResultDto> {
    const task = await this.findOwnedTask(this.prisma, userId, taskId);
    const existing = await this.prisma.taskUpdate.findFirst({
      where: { id: updateId, taskId: task.id, userId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: TaskErrorCode.UpdateNotFound,
        message: 'Task update not found.',
      });
    }
    if (existing.version !== input.version) {
      throw this.versionConflict(existing);
    }
    if (Object.keys(this.diff(existing, input)).length === 0) {
      // Nothing changed: no new version, history entry or Excel job.
      return {
        task: toTaskDto(task),
        update: toUpdateDto(existing),
        excelSync: unchanged(task.workbookId),
      };
    }

    const saved = await this.prisma.$transaction(async (tx): Promise<Saved> => {
      const dataVersion = await this.lockForChange(tx, task);
      const current = await tx.taskUpdate.findUniqueOrThrow({ where: { id: existing.id } });
      const changes = this.diff(current, input);
      const { count } = await tx.taskUpdate.updateMany({
        where: { id: current.id, version: input.version },
        data: {
          status: input.status,
          description: input.description,
          reference: input.reference,
          startTime: input.startTime,
          endTime: input.endTime,
          remarks: input.remarks,
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw this.versionConflict(current);
      }
      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          taskUpdateId: current.id,
          userId,
          action: 'ENTRY_UPDATED',
          changes: { entryDate: formatCalendarDate(current.entryDate), ...changes },
        },
      });
      const jobId = await this.enqueueFor(tx, task, 'ENTRY_UPDATED', dataVersion);
      return {
        task: await this.refreshSummary(tx, task.id),
        update: await tx.taskUpdate.findUniqueOrThrow({ where: { id: current.id } }),
        jobId,
      };
    });
    return this.afterCommit(saved);
  }

  async get(userId: string, taskId: string): Promise<TaskDetailDto> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, userId, deletedAt: null },
      include: {
        workbook: { select: { id: true, name: true } },
        updates: { orderBy: latestFirst },
        history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!task) {
      throw taskNotFound();
    }
    return {
      ...toTaskDto(task),
      workbook: task.workbook,
      updates: task.updates.map(toUpdateDto),
      history: task.history.map(toHistoryDto),
    };
  }

  /**
   * One page of the user's tasks with search, filters and sorting. Uses a count and a page
   * query (index-backed: user + date, trigram name search, task/date unique index for the
   * date range) instead of loading all tasks.
   */
  async list(userId: string, query: ListTasksQuery): Promise<TaskPageDto> {
    if (query.workbookId) {
      await this.resolveWorkbook(userId, query.workbookId);
    }
    const where: Prisma.TaskWhereInput = { userId, deletedAt: null };
    if (query.workbookId) {
      where.workbookId = query.workbookId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.AND = [taskSearchFilter(query.search)];
    }
    if (query.from || query.to) {
      where.updates = {
        some: {
          entryDate: {
            ...(query.from ? { gte: parseCalendarDate(query.from) } : {}),
            ...(query.to ? { lte: parseCalendarDate(query.to) } : {}),
          },
        },
      };
    }

    const [total, tasks] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: TASK_ORDER[query.sort],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          workbook: { select: { id: true, name: true } },
          updates: {
            orderBy: latestFirst,
            take: 1,
            select: { description: true, reference: true, updatedAt: true },
          },
        },
      }),
    ]);

    return {
      items: tasks.map((task) => ({
        ...toTaskDto(task),
        workbook: task.workbook,
        latestDescription: task.updates[0]?.description ?? '',
        latestReference: task.updates[0]?.reference ?? null,
        updatedAt: task.updatedAt.toISOString(),
        lastEntryAt: (task.updates[0]?.updatedAt ?? task.updatedAt).toISOString(),
        completedAt:
          task.status === 'COMPLETED'
            ? (task.updates[0]?.updatedAt ?? task.updatedAt).toISOString()
            : null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * Renames a task (unique per workbook) and/or changes its details (assigned by, priority,
   * project, due date); the Excel rows follow. Details that are not sent stay as they are.
   */
  async rename(
    userId: string,
    taskId: string,
    input: RenameTaskInput,
  ): Promise<SaveTaskSummaryDto> {
    const task = await this.findOwnedTask(this.prisma, userId, taskId);
    if (task.version !== input.version) {
      throw this.taskVersionConflict(task);
    }
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    const data: Prisma.TaskUpdateManyMutationInput = {};
    if (task.name !== input.name) {
      changes.name = { from: task.name, to: input.name };
      data.name = input.name;
      data.nameKey = taskNameKey(input.name);
    }
    for (const field of ['assignedBy', 'priority', 'project'] as const) {
      const next = input[field];
      if (next !== undefined && next !== task[field]) {
        changes[field] = { from: task[field], to: next };
        Object.assign(data, { [field]: next });
      }
    }
    const dueDate = task.dueDate ? formatCalendarDate(task.dueDate) : null;
    if (input.dueDate !== undefined && input.dueDate !== dueDate) {
      changes.dueDate = { from: dueDate, to: input.dueDate };
      data.dueDate = input.dueDate ? parseCalendarDate(input.dueDate) : null;
    }
    if (Object.keys(changes).length === 0) {
      return { task: toTaskDto(task), excelSync: unchanged(task.workbookId) };
    }
    const onlyRenamed = Object.keys(changes).length === 1 && 'name' in changes;

    let renamed: { task: Task; jobId: string };
    try {
      renamed = await this.prisma.$transaction(async (tx) => {
        const { dataVersion } = await tx.workbook.update({
          where: { id: task.workbookId },
          data: { dataVersion: { increment: 1 } },
          select: { dataVersion: true },
        });
        const { count } = await tx.task.updateMany({
          where: { id: task.id, userId, deletedAt: null, version: input.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (count === 0) {
          throw await this.taskChangedOrGone(tx, userId, task.id);
        }
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            userId,
            action: onlyRenamed ? 'TASK_RENAMED' : 'TASK_UPDATED',
            changes,
          },
        });
        const jobId = await this.enqueueFor(tx, task, 'TASK_RENAMED', dataVersion);
        return { task: await tx.task.findUniqueOrThrow({ where: { id: task.id } }), jobId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: TaskErrorCode.NameTaken,
          message: 'Another task in this workbook already has this name.',
          errors: [
            { field: 'name', message: 'Another task in this workbook already has this name.' },
          ],
        });
      }
      throw error;
    }
    this.syncWorker.nudge();
    return {
      task: toTaskDto(renamed.task),
      excelSync: queued(renamed.task.workbookId, renamed.jobId),
    };
  }

  /**
   * Deletes a task: it disappears from lists, duplicate detection and its Excel workbook, but
   * the task, its dated updates and its audit trail stay in the database (soft delete), and a
   * TASK_DELETED history entry records what was removed. The task number is never reused and
   * the name becomes available again.
   */
  async remove(userId: string, taskId: string, version: number): Promise<DeleteTaskResultDto> {
    const task = await this.findOwnedTask(this.prisma, userId, taskId);
    if (task.version !== version) {
      throw this.taskVersionConflict(task);
    }

    const jobId = await this.prisma.$transaction(async (tx) => {
      // Lock order workbook → task, as everywhere else.
      const { dataVersion } = await tx.workbook.update({
        where: { id: task.workbookId },
        data: { dataVersion: { increment: 1 }, taskCount: { decrement: 1 } },
        select: { dataVersion: true },
      });
      const { count } = await tx.task.updateMany({
        where: { id: task.id, userId, deletedAt: null, version },
        data: { deletedAt: new Date(), nameKey: null, version: { increment: 1 } },
      });
      if (count === 0) {
        throw await this.taskChangedOrGone(tx, userId, task.id);
      }
      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          userId,
          action: 'TASK_DELETED',
          changes: {
            taskNumber: task.taskNumber,
            name: task.name,
            workbookId: task.workbookId,
            status: task.status,
            lastEntryDate: formatCalendarDate(task.lastEntryDate),
            entryCount: task.entryCount,
          },
        },
      });
      return this.enqueueFor(tx, task, 'TASK_DELETED', dataVersion);
    });

    this.syncWorker.nudge();
    return { taskId: task.id, excelSync: queued(task.workbookId, jobId) };
  }

  /** Most recent dated updates, optionally for one workbook. */
  /**
   * Dashboard figures for the user: task counts by status, daily activity for the `days` days
   * ending on `today` (the user's local date), week-over-week entries and per-workbook progress.
   * Grouped queries only, so the cost does not grow with the number of rows returned.
   */
  async summary(userId: string, query: TaskSummaryQuery): Promise<TaskSummaryDto> {
    const todayKey = query.today ?? formatCalendarDate(new Date());
    const today = parseCalendarDate(todayKey);
    // At least 14 days are read, for the "last 7 days vs previous 7 days" comparison.
    const windowDays = Math.max(query.days, 14);
    const from = new Date(today.getTime() - (windowDays - 1) * DAY_MS);
    const liveTasks = { userId, deletedAt: null };

    const [statusGroups, entries, dayGroups, workbooks, workbookGroups] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where: liveTasks, _count: { _all: true } }),
      this.prisma.taskUpdate.count({ where: { userId, task: { deletedAt: null } } }),
      this.prisma.taskUpdate.groupBy({
        by: ['entryDate', 'status'],
        where: { userId, task: { deletedAt: null }, entryDate: { gte: from, lte: today } },
        _count: { _all: true },
      }),
      this.prisma.workbook.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
      this.prisma.task.groupBy({
        by: ['workbookId', 'status'],
        where: liveTasks,
        _count: { _all: true },
      }),
    ]);

    const byStatus = emptyStatusCounts();
    for (const group of statusGroups) {
      byStatus[group.status] = group._count._all;
    }
    const tasks = Object.values(byStatus).reduce((sum, count) => sum + count, 0);

    const perDay = new Map<string, { entries: number; completed: number }>();
    for (const group of dayGroups) {
      const key = formatCalendarDate(group.entryDate);
      const day = perDay.get(key) ?? { entries: 0, completed: 0 };
      day.entries += group._count._all;
      if (group.status === 'COMPLETED') {
        day.completed += group._count._all;
      }
      perDay.set(key, day);
    }
    const dayAt = (offset: number) => {
      const date = formatCalendarDate(new Date(today.getTime() - offset * DAY_MS));
      return { date, ...(perDay.get(date) ?? { entries: 0, completed: 0 }) };
    };
    const sumEntries = (fromOffset: number, toOffset: number) => {
      let total = 0;
      for (let offset = fromOffset; offset <= toOffset; offset += 1) {
        total += dayAt(offset).entries;
      }
      return total;
    };

    const perWorkbook = new Map<string, ReturnType<typeof emptyStatusCounts>>();
    for (const group of workbookGroups) {
      const counts = perWorkbook.get(group.workbookId) ?? emptyStatusCounts();
      counts[group.status] = group._count._all;
      perWorkbook.set(group.workbookId, counts);
    }

    return {
      today: todayKey,
      totals: {
        tasks,
        entries,
        workbooks: workbooks.length,
        completed: byStatus.COMPLETED,
        open: tasks - byStatus.COMPLETED,
        completionRate: tasks === 0 ? 0 : Math.round((byStatus.COMPLETED / tasks) * 100),
      },
      byStatus,
      activity: Array.from({ length: query.days }, (_, i) => dayAt(query.days - 1 - i)),
      periods: {
        today: dayAt(0).entries,
        last7Days: sumEntries(0, 6),
        previous7Days: sumEntries(7, 13),
      },
      workbooks: workbooks.map((workbook) => {
        const counts = perWorkbook.get(workbook.id) ?? emptyStatusCounts();
        return {
          id: workbook.id,
          name: workbook.name,
          tasks: Object.values(counts).reduce((sum, count) => sum + count, 0),
          completed: counts.COMPLETED,
          byStatus: counts,
        };
      }),
    };
  }

  /**
   * Work report: every daily entry dated in [from, to] (oldest first) with its task, and the
   * totals of the period. Without bounds it covers all of the user's work.
   */
  async report(userId: string, query: TaskReportQuery): Promise<TaskReportDto> {
    if (query.workbookId) {
      await this.resolveWorkbook(userId, query.workbookId);
    }
    const found = await this.prisma.taskUpdate.findMany({
      where: {
        userId,
        task: { deletedAt: null, ...(query.workbookId ? { workbookId: query.workbookId } : {}) },
        ...(query.from || query.to
          ? {
              entryDate: {
                ...(query.from ? { gte: parseCalendarDate(query.from) } : {}),
                ...(query.to ? { lte: parseCalendarDate(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { task: { include: { workbook: { select: { name: true } } } } },
      orderBy: [{ entryDate: 'asc' }, { task: { taskNumber: 'asc' } }, { createdAt: 'asc' }],
      take: REPORT_ENTRY_LIMIT + 1,
    });
    const updates = found.slice(0, REPORT_ENTRY_LIMIT);

    const tasks = new Map<string, Task>();
    const days = new Set<string>();
    let minutesWorked = 0;
    let entriesWithoutTime = 0;
    for (const update of updates) {
      tasks.set(update.taskId, update.task);
      days.add(formatCalendarDate(update.entryDate));
      const minutes = minutesBetween(update.startTime, update.endTime);
      if (minutes === null) {
        entriesWithoutTime += 1;
      } else {
        minutesWorked += minutes;
      }
    }

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      totals: {
        entries: updates.length,
        tasks: tasks.size,
        completedTasks: [...tasks.values()].filter((task) => task.status === 'COMPLETED').length,
        daysWorked: days.size,
        minutesWorked,
        entriesWithoutTime,
      },
      entries: updates.map((update) => ({
        ...toUpdateDto(update),
        task: toTaskDto(update.task),
        workbookName: update.task.workbook.name,
      })),
      truncated: found.length > REPORT_ENTRY_LIMIT,
    };
  }

  /**
   * The work report as an Excel or PDF file, with the name to download it under (without the
   * extension).
   */
  async exportReport(
    userId: string,
    { format, ...query }: ReportDownloadQuery,
  ): Promise<{ data: Buffer; fileName: string }> {
    const [report, user] = await Promise.all([
      this.report(userId, query),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    ]);
    const info = {
      userName: user.name,
      periodLabel: reportPeriodLabel(report.from, report.to),
      generatedAt: new Date(),
    };
    const data =
      format === 'pdf'
        ? await buildReportPdf(report, info)
        : await buildReportWorkbook(report, info);
    return { data, fileName: reportFileName(report.from, report.to) };
  }

  async listRecent(userId: string, query: ListTaskUpdatesQuery): Promise<RecentTaskUpdatesDto> {
    if (query.workbookId) {
      await this.resolveWorkbook(userId, query.workbookId);
    }
    const updates = await this.prisma.taskUpdate.findMany({
      where: {
        userId,
        task: { deletedAt: null, ...(query.workbookId ? { workbookId: query.workbookId } : {}) },
      },
      include: { task: { select: { workbookId: true, taskNumber: true, name: true } } },
      orderBy: latestFirst,
      take: query.limit,
    });
    return {
      updates: updates.map((update) => ({
        ...toUpdateDto(update),
        workbookId: update.task.workbookId,
        taskNumber: update.task.taskNumber,
        taskName: update.task.name,
      })),
    };
  }

  /**
   * The workbook a task goes into: the requested one (must be the user's), otherwise the
   * default, otherwise the only workbook. With several workbooks and no default the user must
   * choose.
   */
  private async resolveWorkbook(userId: string, workbookId?: string): Promise<WorkbookRef> {
    if (workbookId) {
      const workbook = await this.prisma.workbook.findFirst({
        where: { id: workbookId, userId },
        select: { id: true, name: true },
      });
      if (!workbook) {
        throw new NotFoundException({
          code: TaskErrorCode.WorkbookNotFound,
          message: 'Workbook not found.',
        });
      }
      return workbook;
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        defaultWorkbook: { select: { id: true, name: true } },
        workbooks: { select: { id: true, name: true }, take: 2 },
      },
    });
    if (user.defaultWorkbook) {
      return user.defaultWorkbook;
    }
    const [only, another] = user.workbooks;
    if (!only) {
      throw new BadRequestException({
        code: TaskErrorCode.NoWorkbook,
        message: 'Create a workbook before adding tasks.',
      });
    }
    if (another) {
      throw new BadRequestException({
        code: TaskErrorCode.WorkbookRequired,
        message: 'Choose the workbook this task belongs to.',
        errors: [{ field: 'workbookId', message: 'Choose a workbook.' }],
      });
    }
    return only;
  }

  private async findMatch(
    db: Db,
    workbook: WorkbookRef,
    nameKey: string,
    entryDate?: string,
  ): Promise<TaskMatchDto | null> {
    const task = await db.task.findUnique({
      where: { workbookId_nameKey: { workbookId: workbook.id, nameKey } },
    });
    if (!task) {
      return null;
    }
    const onDate = entryDate
      ? await db.taskUpdate.findUnique({
          where: { taskId_entryDate: { taskId: task.id, entryDate: parseCalendarDate(entryDate) } },
        })
      : null;
    const target =
      onDate ??
      (await db.taskUpdate.findFirstOrThrow({ where: { taskId: task.id }, orderBy: latestFirst }));
    return {
      task: toTaskDto(task),
      workbookName: workbook.name,
      targetUpdate: toUpdateDto(target),
      hasUpdateOnDate: onDate !== null,
    };
  }

  private async findOwnedTask(db: Db, userId: string, taskId: string): Promise<Task> {
    const task = await db.task.findFirst({ where: { id: taskId, userId, deletedAt: null } });
    if (!task) {
      throw taskNotFound();
    }
    return task;
  }

  /** After a conditional update matched nothing: deleted/foreign (404) or changed (409). */
  private async taskChangedOrGone(db: Db, userId: string, taskId: string) {
    const current = await db.task.findFirst({ where: { id: taskId, userId, deletedAt: null } });
    return current ? this.taskVersionConflict(current) : taskNotFound();
  }

  /**
   * Row locks for a change to an existing task, always in the order workbook → task (the same
   * order a workbook deletion uses); marks the workbook's Excel file as out of date and bumps
   * the task version. Fails if the task was deleted meanwhile.
   */
  private async lockForChange(tx: Db, task: Task): Promise<number> {
    const { dataVersion } = await tx.workbook.update({
      where: { id: task.workbookId },
      data: { dataVersion: { increment: 1 } },
      select: { dataVersion: true },
    });
    const { count } = await tx.task.updateMany({
      where: { id: task.id, deletedAt: null },
      data: { version: { increment: 1 } },
    });
    if (count === 0) {
      throw taskNotFound();
    }
    return dataVersion;
  }

  /**
   * Every entry is a row of the workbook's Excel file, which is rebuilt in memory on each
   * change: the number of entries per workbook is capped (MAX_ENTRIES_PER_WORKBOOK). Called
   * while holding the workbook row lock, so concurrent additions cannot exceed the cap.
   */
  private async assertCapacity(tx: Db, workbookId: string): Promise<void> {
    const entries = await tx.taskUpdate.count({ where: { task: { workbookId, deletedAt: null } } });
    if (entries >= this.maxEntriesPerWorkbook) {
      throw new ConflictException({
        code: TaskErrorCode.WorkbookFull,
        message: `This workbook has reached its limit of ${this.maxEntriesPerWorkbook} entries. Create a new workbook for new tasks.`,
      });
    }
  }

  /** Queues the Excel job for a change to an existing task, inside the change's transaction. */
  private enqueueFor(
    tx: Db,
    task: Task,
    reason: ExcelSyncReason,
    targetDataVersion: number,
  ): Promise<string> {
    return this.syncQueue.enqueue(tx, {
      workbookId: task.workbookId,
      userId: task.userId,
      taskId: task.id,
      reason,
      targetDataVersion,
    });
  }

  /** The task's status and date follow its most recent dated update. */
  private async refreshSummary(tx: Db, taskId: string): Promise<Task> {
    const latest = await tx.taskUpdate.findFirstOrThrow({
      where: { taskId },
      orderBy: latestFirst,
    });
    return tx.task.update({
      where: { id: taskId },
      data: { status: latest.status, lastEntryDate: latest.entryDate },
    });
  }

  private diff(current: TaskUpdate, input: EditTaskUpdateInput) {
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    for (const field of [
      'status',
      'description',
      'reference',
      'startTime',
      'endTime',
      'remarks',
    ] as const) {
      if (current[field] !== input[field]) {
        changes[field] = { from: current[field], to: input[field] };
      }
    }
    return changes;
  }

  /** The transaction has committed: wake the worker (never waits for it) and respond. */
  private afterCommit(saved: Saved): SaveTaskResultDto {
    this.syncWorker.nudge();
    return {
      task: toTaskDto(saved.task),
      update: toUpdateDto(saved.update),
      excelSync: queued(saved.task.workbookId, saved.jobId),
    };
  }

  private duplicateTask(match: TaskMatchDto) {
    return new ConflictException({
      code: TaskErrorCode.AlreadyExists,
      message: 'This task already exists. What would you like to do?',
      details: match,
    });
  }

  private taskVersionConflict(current: Task) {
    return new ConflictException({
      code: TaskErrorCode.TaskVersionConflict,
      message: 'This task was changed elsewhere. Reload and try again.',
      details: { current: toTaskDto(current) },
    });
  }

  private versionConflict(current: TaskUpdate) {
    return new ConflictException({
      code: TaskErrorCode.VersionConflict,
      message: 'This task entry was changed elsewhere. Reload and try again.',
      details: { current: toUpdateDto(current) },
    });
  }
}
