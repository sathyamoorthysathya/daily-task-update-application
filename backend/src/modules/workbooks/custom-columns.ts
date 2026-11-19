import { z } from 'zod';
import {
  DAILY_TASK_COLUMNS,
  INTERNAL_ID_COLUMNS,
  WORK_DETAIL_COLUMNS,
} from './workbook.constants.js';

/**
 * Extra columns a user adds to a workbook when creating it (e.g. "Client", "Ticket ID").
 * They are written after the built-in columns of the "Daily Tasks" sheet, and every daily
 * entry can hold one text value per column, stored by the column's id.
 */
// A type alias (not an interface) so it can be stored as Prisma JSON.
export type CustomColumn = {
  /** Stable id ("c1", "c2", ...), the key of the values stored on each entry. */
  id: string;
  name: string;
};

export type CustomValues = Record<string, string>;

export const MAX_CUSTOM_COLUMNS = 10;
export const CUSTOM_COLUMN_NAME_MAX = 50;
export const CUSTOM_VALUE_MAX = 1000;

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const BUILT_IN_HEADERS = new Set(
  [...DAILY_TASK_COLUMNS, ...INTERNAL_ID_COLUMNS, ...WORK_DETAIL_COLUMNS].map((column) =>
    column.header.toLowerCase(),
  ),
);

const columnNameSchema = z
  .string({ error: 'Column name must be text' })
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Column name is required')
      .max(
        CUSTOM_COLUMN_NAME_MAX,
        `Column names must be at most ${CUSTOM_COLUMN_NAME_MAX} characters`,
      )
      .refine(
        (value) => !CONTROL_CHARACTERS.test(value),
        'Column names cannot contain control characters',
      )
      .refine(
        (value) => !BUILT_IN_HEADERS.has(value.toLowerCase()),
        'The sheet already has a column with this name',
      ),
  );

/** Names of the extra columns, in sheet order: unique (case-insensitive), at most 10. */
export const customColumnNamesSchema = z
  .array(columnNameSchema, { error: 'Columns must be a list of names' })
  .max(MAX_CUSTOM_COLUMNS, `You can add up to ${MAX_CUSTOM_COLUMNS} extra columns`)
  .superRefine((names, context) => {
    const seen = new Set<string>();
    names.forEach((name, index) => {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', path: [index], message: `“${name}” is listed twice` });
      }
      seen.add(key);
    });
  });

/** Values of the extra columns sent with an entry, by column id. */
export const customValuesSchema = z.record(
  z.string().max(20),
  z
    .string({ error: 'Column values must be text' })
    .trim()
    .max(CUSTOM_VALUE_MAX, `Column values must be at most ${CUSTOM_VALUE_MAX} characters`),
  { error: 'Column values must be an object' },
);

/** Column ids are assigned in order and never depend on the (user-chosen) names. */
export function toCustomColumns(names: readonly string[]): CustomColumn[] {
  return names.map((name, index) => ({ id: `c${index + 1}`, name }));
}

/** A workbook's stored columns (JSON), read defensively. */
export function parseCustomColumns(value: unknown): CustomColumn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (column): column is CustomColumn =>
      typeof column === 'object' &&
      column !== null &&
      typeof (column as CustomColumn).id === 'string' &&
      typeof (column as CustomColumn).name === 'string',
  );
}

/** An entry's stored values (JSON), read defensively. */
export function parseCustomValues(value: unknown): CustomValues {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * The values to store for an entry: only the workbook's own columns, non-empty values only
 * (an empty value means "not set"). Unknown column ids are ignored.
 */
export function cleanCustomValues(
  values: CustomValues | undefined,
  columns: readonly CustomColumn[],
): CustomValues {
  const result: CustomValues = {};
  for (const column of columns) {
    const value = values?.[column.id];
    if (value) {
      result[column.id] = value;
    }
  }
  return result;
}
