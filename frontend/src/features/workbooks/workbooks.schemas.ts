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
