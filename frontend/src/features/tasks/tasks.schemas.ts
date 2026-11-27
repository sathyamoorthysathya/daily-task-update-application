// Mirrors backend/src/modules/tasks/tasks.schemas.ts for instant feedback; the API re-validates.
import { z } from 'zod';
import type { CreateTaskInput, TaskDetails, TaskWorkInput } from './task.types';

/** C0 control characters and DEL (browsers drop some of them inside URLs). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const STATUSES = ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD'] as const;

/** Largest task number a user may choose (same limit as the API). */
export const MAX_TASK_NUMBER = 999_999;

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

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

const TYPES = [
  'FEATURE',
  'BUG',
  'IMPROVEMENT',
  'RESEARCH',
  'TESTING',
  'DOCUMENTATION',
  'MEETING',
  'SUPPORT',
  'OTHER',
] as const;

/** Optional one-line text (assigned by, project): inner whitespace collapsed. */
const lineSchema = (label: string, max = 100) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `${label} must be at most ${max} characters`));

/** Longest own task type ("Other"). */
export const TASK_TYPE_OTHER_MAX = 50;

/** Optional time of day from a time input ("HH:MM"; empty = not set). */
const timeSchema = z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time such as 09:30');

/** Details of the task itself (all optional; empty = not set). */
export const taskDetailFields = {
  taskType: z.enum(['', ...TYPES], { error: 'Choose a task type' }),
  /** The user's own type, with "Other" (see checkTaskTypeOther). */
  taskTypeOther: lineSchema('Task type', TASK_TYPE_OTHER_MAX),
  assignedBy: lineSchema('Assigned by'),
  priority: z.enum(['', ...PRIORITIES], { error: 'Choose a priority' }),
  project: lineSchema('Project'),
  dueDate: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
    .refine((value) => value === '' || value >= '2000-01-01', 'The date cannot be before 2000'),
};

/** Details of one day's work besides description, reference and status. */
export const workDetailFields = {
  startTime: timeSchema,
  endTime: timeSchema,
  remarks: z.string().trim().max(2000, 'Remarks must be at most 2000 characters'),
};

/** "Other" needs the user's own type (same rule as the API). */
export function checkTaskTypeOther(
  value: { taskType: string; taskTypeOther: string },
  context: z.RefinementCtx,
): void {
  if (value.taskType === 'OTHER' && value.taskTypeOther === '') {
    context.addIssue({ code: 'custom', path: ['taskTypeOther'], message: 'Enter the task type' });
  }
}

/** An end time needs a start time and must come after it (same rules as the API). */
export function checkWorkingHours(
  value: { startTime: string; endTime: string },
  context: z.RefinementCtx,
): void {
  if (value.endTime === '') {
    return;
  }
  if (value.startTime === '') {
    context.addIssue({
      code: 'custom',
      path: ['startTime'],
      message: 'Enter a start time for the end time',
    });
  } else if (value.endTime <= value.startTime) {
    context.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'The end time must be after the start time',
    });
  }
}

export const taskFormSchema = z
  .object({
    workbookId: z.string().min(1, 'Choose a workbook'),
    /** Empty = numbered automatically. */
    taskNumber: z
      .string()
      .trim()
      .regex(/^$|^\d+$/, 'Enter a whole number, e.g. 12')
      .refine((value) => value === '' || Number(value) >= 1, 'Task numbers start at 1')
      .refine(
        (value) => value === '' || Number(value) <= MAX_TASK_NUMBER,
        `Task number must be at most ${MAX_TASK_NUMBER}`,
      ),
    name: taskNameSchema,
    entryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
      .refine((value) => value >= '2000-01-01', 'The date cannot be before 2000'),
    description: descriptionSchema,
    reference: referenceSchema,
    status: z.enum(STATUSES, { error: 'Choose a status' }),
    ...taskDetailFields,
    ...workDetailFields,
  })
  .superRefine((value, context) => {
    checkTaskTypeOther(value, context);
    checkWorkingHours(value, context);
  });

export type ParsedTaskForm = z.output<typeof taskFormSchema>;

const orNull = (value: string) => (value === '' ? null : value);

/** Form values of the task details as the API expects them (empty = none). */
export function toTaskDetails(values: {
  taskType: '' | TaskDetails['taskType'];
  taskTypeOther: string;
  assignedBy: string;
  priority: '' | TaskDetails['priority'];
  project: string;
  dueDate: string;
}): TaskDetails {
  return {
    taskType: values.taskType || null,
    // The own type is kept only with "Other".
    taskTypeOther: values.taskType === 'OTHER' ? orNull(values.taskTypeOther) : null,
    assignedBy: orNull(values.assignedBy),
    priority: values.priority || null,
    project: orNull(values.project),
    dueDate: orNull(values.dueDate),
  };
}

/** Form values of the working hours and remarks as the API expects them. */
export function toWorkDetails(values: {
  startTime: string;
  endTime: string;
  remarks: string;
}): Pick<TaskWorkInput, 'startTime' | 'endTime' | 'remarks'> {
  return {
    startTime: orNull(values.startTime),
    endTime: orNull(values.endTime),
    remarks: orNull(values.remarks),
  };
}

export function toCreateTaskInput(values: ParsedTaskForm): CreateTaskInput {
  return {
    workbookId: values.workbookId,
    // Only a number the user chose is sent; otherwise the API numbers the task.
    ...(values.taskNumber === '' ? {} : { taskNumber: Number(values.taskNumber) }),
    name: values.name,
    ...toTaskDetails(values),
    entryDate: values.entryDate,
    description: values.description,
    reference: values.reference === '' ? null : values.reference,
    status: values.status,
    ...toWorkDetails(values),
  };
}

/**
 * Values typed into a workbook's extra columns, as the API expects them: trimmed, and only
 * the columns of that workbook (an empty value means "not set").
 */
export function toCustomValues(
  values: Record<string, string>,
  columns: readonly { id: string }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const column of columns) {
    const value = values[column.id]?.trim();
    if (value) {
      result[column.id] = value;
    }
  }
  return result;
}

/** Minutes between two "HH:MM" times; null unless both are set and in order. */
export function minutesBetween(startTime: string, endTime: string): number | null {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(startTime) || !valid.test(endTime) || endTime <= startTime) {
    return null;
  }
  return minutes(endTime) - minutes(startTime);
}

/** "45 min", "3 h", "3 h 45 min" */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "09:30" in the user's clock format, e.g. "9:30 AM". */
export function formatClock(time: string): string {
  const date = new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "9:30 AM – 1:15 PM", or "from 9:30 AM" while the work is not finished. */
export function formatWorkingHours(startTime: string | null, endTime: string | null): string {
  if (!startTime) {
    return '';
  }
  return endTime
    ? `${formatClock(startTime)} – ${formatClock(endTime)}`
    : `from ${formatClock(startTime)}`;
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
