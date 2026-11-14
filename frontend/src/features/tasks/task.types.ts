export type TaskStatus = 'TO_DO' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED' | 'ON_HOLD';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** Details of the task itself; the same for all of its daily entries. */
export interface TaskDetails {
  /** Who gave the task (manager, team lead, client...). */
  assignedBy: string | null;
  priority: TaskPriority | null;
  /** Project or module the task belongs to. */
  project: string | null;
  /** Deadline, YYYY-MM-DD. */
  dueDate: string | null;
}

export interface Task extends TaskDetails {
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
  /** Working hours of the day, "HH:MM" (24 hours). */
  startTime: string | null;
  endTime: string | null;
  /** Minutes between start and end time; null unless both are set. */
  minutesWorked: number | null;
  /** Blockers or notes for the manager. */
  remarks: string | null;
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

/** What one day's entry records (everything except its date). */
export interface TaskWorkInput {
  description: string;
  reference: string | null;
  status: TaskStatus;
  startTime: string | null;
  endTime: string | null;
  remarks: string | null;
}

export interface TaskEntryInput extends TaskWorkInput {
  entryDate: string;
}

export interface CreateTaskInput extends TaskEntryInput, TaskDetails {
  workbookId?: string;
  name: string;
}

/** One daily entry in a work report, with its task. */
export interface ReportEntry extends TaskUpdate {
  task: Task;
  workbookName: string;
}

export interface ReportTotals {
  entries: number;
  /** Different tasks worked on. */
  tasks: number;
  /** Of those, tasks that are completed now. */
  completedTasks: number;
  daysWorked: number;
  minutesWorked: number;
  /** Entries without a start and end time (not counted in the working time). */
  entriesWithoutTime: number;
}

export interface TaskReport {
  from: string | null;
  to: string | null;
  totals: ReportTotals;
  /** Oldest date first. */
  entries: ReportEntry[];
  /** More entries exist than are returned. */
  truncated: boolean;
}

export interface WorkbookRef {
  id: string;
  name: string;
}

export interface TaskListItem extends Task {
  workbook: WorkbookRef;
  latestDescription: string;
  latestReference: string | null;
  /** Last change to the task or its entries. */
  updatedAt: string;
  /** When the latest entry was last saved. */
  lastEntryAt: string;
  /** When the latest entry was saved as Completed; null while the task is open. */
  completedAt: string | null;
}

export interface TaskPage {
  items: TaskListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type TaskHistoryAction =
  | 'TASK_CREATED'
  | 'ENTRY_ADDED'
  | 'ENTRY_UPDATED'
  | 'TASK_RENAMED'
  | 'TASK_DELETED'
  | 'TASK_UPDATED';

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
