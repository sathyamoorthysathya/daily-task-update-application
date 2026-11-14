import type { TaskDetails, TaskUpdate } from '../features/tasks/task.types';
import type { Workbook, WorkbookList } from '../features/workbooks/workbook.types';

/** A task without the optional details (assigned by, priority, project, due date). */
export const NO_TASK_DETAILS: TaskDetails = {
  assignedBy: null,
  priority: null,
  project: null,
  dueDate: null,
};

/** A daily entry without working hours or remarks. */
export const NO_WORK_DETAILS: Pick<
  TaskUpdate,
  'startTime' | 'endTime' | 'minutesWorked' | 'remarks'
> = {
  startTime: null,
  endTime: null,
  minutesWorked: null,
  remarks: null,
};

export function makeWorkbook(overrides: Partial<Workbook>): Workbook {
  return {
    id: '0190a000-0000-4000-8000-00000000000a',
    name: 'Daily Tasks',
    isDefault: false,
    taskCount: 0,
    nextTaskNumber: 1,
    sizeBytes: 6500,
    syncStatus: 'synced',
    syncError: null,
    lastSyncedAt: null,
    version: 1,
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-01-05T09:00:00.000Z',
    ...overrides,
  };
}

export function listOf(...workbooks: Workbook[]): WorkbookList {
  return {
    workbooks,
    defaultWorkbookId: workbooks.find((workbook) => workbook.isDefault)?.id ?? null,
    limit: 20,
  };
}
