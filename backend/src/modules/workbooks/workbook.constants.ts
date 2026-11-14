export const DAILY_TASKS_SHEET_NAME = 'Daily Tasks';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Columns of the "Daily Tasks" worksheet, in order (A-F). Shared with task writing. */
export const DAILY_TASK_COLUMNS = [
  { key: 'taskNumber', header: 'Task Number', width: 14 },
  { key: 'date', header: 'Date', width: 14 },
  { key: 'taskName', header: 'Task Name', width: 32 },
  { key: 'taskDescription', header: 'Task Description', width: 60 },
  { key: 'reference', header: 'Documentation Link / Reference', width: 42 },
  { key: 'status', header: 'Status', width: 16 },
] as const;

/**
 * Hidden columns G-H: internal row references. Every data row carries the IDs of its task and
 * task update, so a row can always be traced to (and checked against) its database record.
 */
export const INTERNAL_ID_COLUMNS = [
  { key: 'taskId', header: 'Task ID (internal)', width: 38 },
  { key: 'taskUpdateId', header: 'Task Update ID (internal)', width: 38 },
] as const;

/**
 * Work details, columns I-P. They come after the original columns so that A-H keep their
 * positions in workbooks created before these details existed.
 */
export const WORK_DETAIL_COLUMNS = [
  { key: 'project', header: 'Project / Module', width: 24 },
  { key: 'assignedBy', header: 'Assigned By', width: 22 },
  { key: 'priority', header: 'Priority', width: 12 },
  { key: 'dueDate', header: 'Due Date', width: 14 },
  { key: 'startTime', header: 'Start Time', width: 12 },
  { key: 'endTime', header: 'End Time', width: 12 },
  { key: 'hoursWorked', header: 'Hours Worked', width: 14 },
  { key: 'remarks', header: 'Remarks / Blockers', width: 44 },
] as const;

/** First and last column (1-based) of the work details. */
export const WORK_DETAIL_FIRST_COLUMN = DAILY_TASK_COLUMNS.length + INTERNAL_ID_COLUMNS.length + 1;
export const LAST_COLUMN = WORK_DETAIL_FIRST_COLUMN + WORK_DETAIL_COLUMNS.length - 1;

export const WorkbookErrorCode = {
  NotFound: 'WORKBOOK_NOT_FOUND',
  NameTaken: 'WORKBOOK_NAME_TAKEN',
  LimitReached: 'WORKBOOK_LIMIT_REACHED',
  VersionConflict: 'WORKBOOK_VERSION_CONFLICT',
  Busy: 'WORKBOOK_BUSY',
  FileUnavailable: 'WORKBOOK_FILE_UNAVAILABLE',
} as const;
