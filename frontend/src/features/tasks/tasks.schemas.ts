// Mirrors backend/src/modules/tasks/tasks.schemas.ts for instant feedback; the API re-validates.
import { z } from 'zod';
import type { CreateTaskInput } from './task.types';

/** C0 control characters and DEL (browsers drop some of them inside URLs). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const STATUSES = ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD'] as const;

/** Today's date in the user's time zone, as YYYY-MM-DD. */
export function todayLocal(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Task name: inner whitespace collapsed, like the API does. */
export const taskNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z.string().min(1, 'Task name is required').max(200, 'Task name must be at most 200 characters'),
  );

export const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'Description is required')
  .max(5000, 'Description must be at most 5000 characters');

/** Optional link or reference text; links must be http(s) (same rules as the API). */
export const referenceSchema = z
  .string()
  .trim()
  .max(2000, 'Reference must be at most 2000 characters')
  .refine((value) => !CONTROL_CHARACTERS.test(value), 'Reference cannot contain control characters')
  .refine(
    (value) => !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^https?:\/\/\S+$/i.test(value),
    'Links must start with http:// or https://',
  );

export const taskFormSchema = z.object({
  workbookId: z.string().min(1, 'Choose a workbook'),
  name: taskNameSchema,
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
    .refine((value) => value >= '2000-01-01', 'The date cannot be before 2000'),
  description: descriptionSchema,
  reference: referenceSchema,
  status: z.enum(STATUSES, { error: 'Choose a status' }),
});

export type ParsedTaskForm = z.output<typeof taskFormSchema>;

export function toCreateTaskInput(values: ParsedTaskForm): CreateTaskInput {
  return {
    workbookId: values.workbookId,
    name: values.name,
    entryDate: values.entryDate,
    description: values.description,
    reference: values.reference === '' ? null : values.reference,
    status: values.status,
  };
}

export function formatTaskDate(isoDate: string): string {
  // Calendar dates have no time zone: format them as UTC so the day never shifts.
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
