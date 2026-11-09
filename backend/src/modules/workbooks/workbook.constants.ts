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

export const WorkbookErrorCode = {
  NotFound: 'WORKBOOK_NOT_FOUND',
  NameTaken: 'WORKBOOK_NAME_TAKEN',
  LimitReached: 'WORKBOOK_LIMIT_REACHED',
  VersionConflict: 'WORKBOOK_VERSION_CONFLICT',
  Busy: 'WORKBOOK_BUSY',
  FileUnavailable: 'WORKBOOK_FILE_UNAVAILABLE',
} as const;
