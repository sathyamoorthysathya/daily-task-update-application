import { z } from 'zod';
import { TASK_STATUS_VALUES } from './task-status.js';

/** C0 control characters and DEL (browsers drop some of them inside URLs). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const DAY_MS = 86_400_000;
const EARLIEST_DATE = '2000-01-01';
/** How far ahead a task date may be (planned work). */
const MAX_DAYS_AHEAD = 366;

/** Collapses whitespace and normalises Unicode so equal-looking names compare equal. */
export function normaliseTaskName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Duplicate-detection key: normalised, case-insensitive. */
export function taskNameKey(name: string): string {
  return normaliseTaskName(name).toLowerCase();
}

/** Calendar date "YYYY-MM-DD" → UTC midnight (PostgreSQL DATE). */
export function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const entryDateSchema = z
  .string({ error: 'Task date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')
  .refine((value) => {
    const date = parseCalendarDate(value);
    return !Number.isNaN(date.getTime()) && formatCalendarDate(date) === value;
  }, 'Enter a valid date')
  .refine((value) => value >= EARLIEST_DATE, 'The date cannot be before 2000')
  .refine(
    (value) => parseCalendarDate(value).getTime() <= Date.now() + MAX_DAYS_AHEAD * DAY_MS,
    'The date cannot be more than a year ahead',
  );

export const taskNameSchema = z
  .string({ error: 'Task name is required' })
  .transform(normaliseTaskName)
  .pipe(
    z.string().min(1, 'Task name is required').max(200, 'Task name must be at most 200 characters'),
  );

const descriptionSchema = z
  .string({ error: 'Description is required' })
  .trim()
  .min(1, 'Description is required')
  .max(5000, 'Description must be at most 5000 characters');

/** Optional link or reference text. Links must use http(s) (no javascript:, file:, ...). */
const referenceSchema = z
  .string({ error: 'Reference must be text' })
  .trim()
  .max(2000, 'Reference must be at most 2000 characters')
  // Browsers ignore tabs/newlines inside URL schemes ("java\tscript:"): reject control characters
  // so the scheme check below sees exactly what a browser would.
  .refine((value) => !CONTROL_CHARACTERS.test(value), 'Reference cannot contain control characters')
  .refine(
    (value) => !/^[a-z][a-z0-9+.-]*:/i.test(value) || /^https?:\/\/\S+$/i.test(value),
    'Links must start with http:// or https://',
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const statusSchema = z.enum(TASK_STATUS_VALUES, { error: 'Choose a valid status' });

export const TASK_PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** A field that may be left out: omitted and null both mean "no value". */
const orNull = <T extends z.ZodType>(schema: T) =>
  schema.optional().transform((value) => value ?? null);

/** Single-line text: trimmed, inner whitespace collapsed, empty becomes null. */
const lineSchema = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, `${label} must be at most ${max} characters`))
    .transform((value) => (value === '' ? null : value))
    .nullable();

const prioritySchema = z
  .enum(TASK_PRIORITY_VALUES, { error: 'Choose a valid priority' })
  .nullable();

/** Deadline: any valid calendar date from 2000 on (it may be in the past or far ahead). */
const dueDateSchema = z
  .string({ error: 'Due date must be a date' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the due date as YYYY-MM-DD')
  .refine((value) => {
    const date = parseCalendarDate(value);
    return !Number.isNaN(date.getTime()) && formatCalendarDate(date) === value;
  }, 'Enter a valid due date')
  .refine((value) => value >= EARLIEST_DATE, 'The due date cannot be before 2000')
  .nullable();

/** Wall-clock time of day, "HH:MM" (24 hours). */
const timeSchema = (label: string) =>
  orNull(
    z
      .string({ error: `${label} must be a time` })
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, `Enter the ${label.toLowerCase()} as HH:MM`)
      .nullable(),
  );

const remarksSchema = orNull(
  z
    .string({ error: 'Remarks must be text' })
    .trim()
    .max(2000, 'Remarks must be at most 2000 characters')
    .transform((value) => (value === '' ? null : value))
    .nullable(),
);

/** Details of the task itself (the same for all its daily entries); null clears one. */
const taskDetailSchemas = {
  assignedBy: lineSchema('Assigned by', 100),
  priority: prioritySchema,
  project: lineSchema('Project', 100),
  dueDate: dueDateSchema,
};

const taskDetailFields = {
  assignedBy: orNull(taskDetailSchemas.assignedBy),
  priority: orNull(taskDetailSchemas.priority),
  project: orNull(taskDetailSchemas.project),
  dueDate: orNull(taskDetailSchemas.dueDate),
};

/** Details of one day's work. */
const workFields = {
  description: descriptionSchema,
  reference: referenceSchema,
  status: statusSchema,
  startTime: timeSchema('Start time'),
  endTime: timeSchema('End time'),
  remarks: remarksSchema,
};

const entryFields = {
  entryDate: entryDateSchema,
  ...workFields,
};

/** An end time needs a start time and must come after it ("HH:MM" compares as text). */
function checkWorkingHours(
  value: { startTime: string | null; endTime: string | null },
  context: z.RefinementCtx,
): void {
  if (value.endTime === null) {
    return;
  }
  if (value.startTime === null) {
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

export const createTaskSchema = z
  .strictObject({
    /** Omit to use the default workbook. */
    workbookId: z.uuid('Invalid workbook ID').optional(),
    name: taskNameSchema,
    ...taskDetailFields,
    ...entryFields,
  })
  .superRefine(checkWorkingHours);

/** "Create New Daily Task Entry" for an existing task. */
export const addTaskUpdateSchema = z.strictObject(entryFields).superRefine(checkWorkingHours);

/** "Update Existing Task": edits one dated update; its date is part of history and fixed. */
export const editTaskUpdateSchema = z
  .strictObject({
    ...workFields,
    version: z.number({ error: 'Version is required' }).int().min(1),
  })
  .superRefine(checkWorkingHours);

export const lookupTaskQuerySchema = z.object({
  workbookId: z.uuid('Invalid workbook ID').optional(),
  name: taskNameSchema,
  entryDate: entryDateSchema.optional(),
});

export const listTaskUpdatesQuerySchema = z.object({
  workbookId: z.uuid('Invalid workbook ID').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const uuidParamSchema = z.uuid('Invalid ID');

/** Empty query parameters (e.g. "?status=") mean "not filtered". */
const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** A calendar date used as a filter bound (no "not in the future" rule). */
const filterDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')
  .refine((value) => {
    const date = parseCalendarDate(value);
    return !Number.isNaN(date.getTime()) && formatCalendarDate(date) === value;
  }, 'Enter a valid date');

export const TASK_SORTS = ['latest', 'oldest', 'number', 'name'] as const;

export const listTasksQuerySchema = z
  .object({
    /** Task name (contains, case-insensitive) or task number ("12" or "#12"). */
    search: optionalParam(z.string().trim().max(200, 'Search must be at most 200 characters')),
    status: optionalParam(z.enum(TASK_STATUS_VALUES, { error: 'Choose a valid status' })),
    workbookId: optionalParam(z.uuid('Invalid workbook ID')),
    /** Tasks with at least one dated update in [from, to]. */
    from: optionalParam(filterDateSchema),
    to: optionalParam(filterDateSchema),
    sort: optionalParam(z.enum(TASK_SORTS)).transform((value) => value ?? 'latest'),
    page: optionalParam(z.coerce.number().int().min(1).max(100_000)).transform((v) => v ?? 1),
    pageSize: optionalParam(z.coerce.number().int().min(1).max(100)).transform((v) => v ?? 20),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  });

/** Dashboard summary: activity of the `days` calendar days ending on the user's `today`. */
export const taskSummaryQuerySchema = z.object({
  /** The user's local date (the browser knows the user's time zone; the server does not). */
  today: optionalParam(filterDateSchema),
  days: optionalParam(z.coerce.number().int().min(7).max(90)).transform((v) => v ?? 14),
});

/**
 * Renames a task and/or changes its details. Details that are omitted stay as they are; send
 * null (or an empty text) to clear one.
 */
export const renameTaskSchema = z.strictObject({
  name: taskNameSchema,
  assignedBy: taskDetailSchemas.assignedBy.optional(),
  priority: taskDetailSchemas.priority.optional(),
  project: taskDetailSchemas.project.optional(),
  dueDate: taskDetailSchemas.dueDate.optional(),
  version: z.number({ error: 'Version is required' }).int().min(1),
});

/** Work report: the entries dated in [from, to]; without bounds, everything. */
export const taskReportQuerySchema = z
  .object({
    from: optionalParam(filterDateSchema),
    to: optionalParam(filterDateSchema),
    workbookId: optionalParam(z.uuid('Invalid workbook ID')),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  });

export const deleteTaskQuerySchema = z.object({
  version: z.coerce.number({ error: 'Version is required' }).int().min(1),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type AddTaskUpdateInput = z.infer<typeof addTaskUpdateSchema>;
export type EditTaskUpdateInput = z.infer<typeof editTaskUpdateSchema>;
export type LookupTaskQuery = z.infer<typeof lookupTaskQuerySchema>;
export type ListTaskUpdatesQuery = z.infer<typeof listTaskUpdatesQuerySchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type RenameTaskInput = z.infer<typeof renameTaskSchema>;
export type TaskReportQuery = z.infer<typeof taskReportQuerySchema>;

export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;

/** Downloading the work report: the same period filters, and the file format (Excel by default). */
export const reportDownloadQuerySchema = z
  .object({
    from: optionalParam(filterDateSchema),
    to: optionalParam(filterDateSchema),
    workbookId: optionalParam(z.uuid('Invalid workbook ID')),
    format: optionalParam(z.enum(REPORT_FORMATS, { error: 'Choose xlsx or pdf' })).transform(
      (value) => value ?? 'xlsx',
    ),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end date must be on or after the start date',
  });
export type ReportDownloadQuery = z.infer<typeof reportDownloadQuerySchema>;
export type TaskSummaryQuery = z.infer<typeof taskSummaryQuerySchema>;
export type DeleteTaskQuery = z.infer<typeof deleteTaskQuerySchema>;
