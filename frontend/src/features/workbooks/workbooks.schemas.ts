import { z } from 'zod';

// Mirrors backend/src/modules/workbooks/workbooks.schemas.ts; the API re-validates.

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

export const workbookNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Workbook name is required')
      .max(100, 'Workbook name must be at most 100 characters')
      .refine(
        (value) => !FORBIDDEN_NAME_CHARS.test(value),
        'Workbook name cannot contain \\ / : * ? " < > |',
      ),
  );

export const workbookFormSchema = z.object({ name: workbookNameSchema });

/** The columns every workbook's "Daily Tasks" sheet starts with (shown to users). */
export const DAILY_TASK_COLUMNS = [
  'Task Number',
  'Date',
  'Task Name',
  'Task Description',
  'Documentation Link / Reference',
  'Status',
];

/** Headers of every built-in column (A-Q); extra columns cannot reuse them. */
const BUILT_IN_HEADERS = [
  ...DAILY_TASK_COLUMNS,
  'Task ID (internal)',
  'Task Update ID (internal)',
  'Task Type',
  'Project / Module',
  'Assigned By',
  'Priority',
  'Due Date',
  'Start Time',
  'End Time',
  'Hours Worked',
  'Remarks / Blockers',
].map((header) => header.toLowerCase());

export const MAX_EXTRA_COLUMNS = 10;
export const EXTRA_COLUMN_NAME_MAX = 50;
/** Extra columns start after the built-in ones: column R. */
export const FIRST_EXTRA_COLUMN = 18;
/** Longest value of an extra column on an entry. */
export const EXTRA_VALUE_MAX = 1000;

export function normaliseColumnName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Why `name` cannot be added next to `existing` columns, or null when it can. */
export function extraColumnError(name: string, existing: readonly string[]): string | null {
  if (name === '') {
    return 'Enter a column name';
  }
  if (name.length > EXTRA_COLUMN_NAME_MAX) {
    return `Column names must be at most ${EXTRA_COLUMN_NAME_MAX} characters`;
  }
  const key = name.toLowerCase();
  if (BUILT_IN_HEADERS.includes(key)) {
    return 'The sheet already has a column with this name';
  }
  if (existing.some((column) => column.toLowerCase() === key)) {
    return 'You already added this column';
  }
  if (existing.length >= MAX_EXTRA_COLUMNS) {
    return `You can add up to ${MAX_EXTRA_COLUMNS} extra columns`;
  }
  return null;
}

/** Spreadsheet column letter of a 1-based column number: 1 → A, 17 → Q, 27 → AA. */
export function columnLetter(column: number): string {
  let letters = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function taskCountLabel(count: number): string {
  return count === 1 ? '1 task' : `${count} tasks`;
}
