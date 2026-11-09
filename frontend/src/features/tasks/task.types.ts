export type TaskStatus = 'TO_DO' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED' | 'ON_HOLD';

export interface Task {
  id: string;
  workbookId: string;
  taskNumber: number;
  name: string;
  status: TaskStatus;
  lastEntryDate: string;
  entryCount: number;
  /** Optimistic-locking version; send it back when renaming or deleting. */
  version: number;
  createdAt: string;
}

/** One dated submission of a task (one row in the Excel sheet). */
export interface TaskUpdate {
  id: string;
  taskId: string;
  entryDate: string;
  status: TaskStatus;
  description: string;
  reference: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskMatch {
  task: Task;
  workbookName: string;
  /** The entry "Update Existing Task" edits: the one on the chosen date, else the latest. */
  targetUpdate: TaskUpdate;
  /** The task already has an entry on the chosen date (no new daily entry possible). */
  hasUpdateOnDate: boolean;
}

export interface SaveTaskResult {
  task: Task;
  update: TaskUpdate;
  excelSync: ExcelSync;
}

export interface RecentTaskUpdate extends TaskUpdate {
  workbookId: string;
  taskNumber: number;
  taskName: string;
}

export interface TaskEntryInput {
  entryDate: string;
  description: string;
  reference: string | null;
  status: TaskStatus;
}

export interface CreateTaskInput extends TaskEntryInput {
  workbookId?: string;
  name: string;
}

export interface WorkbookRef {
  id: string;
  name: string;
}

export interface TaskListItem extends Task {
  workbook: WorkbookRef;
  latestDescription: string;
  latestReference: string | null;
}

export interface TaskPage {
  items: TaskListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type TaskHistoryAction =
  'TASK_CREATED' | 'ENTRY_ADDED' | 'ENTRY_UPDATED' | 'TASK_RENAMED' | 'TASK_DELETED';

export interface TaskHistoryEntry {
  id: string;
  action: TaskHistoryAction;
  taskUpdateId: string | null;
  changes: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetail extends Task {
  workbook: WorkbookRef;
  /** Newest first. */
  updates: TaskUpdate[];
  /** Oldest first. */
  history: TaskHistoryEntry[];
}

export type TaskSort = 'latest' | 'oldest' | 'number' | 'name';

export interface TaskListQuery {
  search?: string;
  status?: TaskStatus;
  workbookId?: string;
  from?: string;
  to?: string;
  sort?: TaskSort;
  page?: number;
  pageSize?: number;
}

/**
 * What happens to the Excel file after a change. The change itself is already saved:
 * - queued:    a background job updates the workbook file (follow it via its sync status);
 * - unchanged: nothing changed, so no update was needed.
 */
export interface ExcelSync {
  workbookId: string;
  status: 'queued' | 'unchanged';
  jobId: string | null;
}
