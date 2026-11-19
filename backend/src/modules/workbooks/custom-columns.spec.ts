import {
  cleanCustomValues,
  customColumnNamesSchema,
  customValuesSchema,
  parseCustomColumns,
  parseCustomValues,
  toCustomColumns,
} from './custom-columns.js';
import { createWorkbookSchema } from './workbooks.schemas.js';

const issues = (value: unknown) =>
  customColumnNamesSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

describe('custom columns', () => {
  it('normalises column names', () => {
    expect(customColumnNamesSchema.parse(['  Client ', 'Ticket\t  ID'])).toEqual([
      'Client',
      'Ticket ID',
    ]);
  });

  it('rejects empty, too long, duplicate and built-in column names', () => {
    expect(issues([' '])).toEqual(['Column name is required']);
    expect(issues(['x'.repeat(51)])).toEqual(['Column names must be at most 50 characters']);
    expect(issues(['Client', 'client'])).toEqual(['“client” is listed twice']);
    expect(issues(['status'])).toEqual(['The sheet already has a column with this name']);
    expect(issues(['Remarks / Blockers'])).toEqual([
      'The sheet already has a column with this name',
    ]);
    expect(issues(['a\u0007b'])).toEqual(['Column names cannot contain control characters']);
  });

  it('allows at most 10 extra columns', () => {
    const names = Array.from({ length: 11 }, (_, index) => `Column ${index}`);
    expect(issues(names)).toEqual(['You can add up to 10 extra columns']);
    expect(issues(names.slice(0, 10))).toEqual([]);
  });

  it('is optional when creating a workbook', () => {
    expect(createWorkbookSchema.parse({ name: 'Tasks' })).toEqual({ name: 'Tasks' });
    expect(createWorkbookSchema.parse({ name: 'Tasks', customColumns: ['Client'] })).toEqual({
      name: 'Tasks',
      customColumns: ['Client'],
    });
  });

  it('gives columns stable ids in order', () => {
    expect(toCustomColumns(['Client', 'Ticket ID'])).toEqual([
      { id: 'c1', name: 'Client' },
      { id: 'c2', name: 'Ticket ID' },
    ]);
  });

  it('keeps only non-empty values of the workbook’s own columns', () => {
    const columns = toCustomColumns(['Client', 'Ticket ID']);
    const values = customValuesSchema.parse({ c1: '  Acme ', c2: '  ', c9: 'x' });
    expect(cleanCustomValues(values, columns)).toEqual({ c1: 'Acme' });
    expect(cleanCustomValues(undefined, columns)).toEqual({});
  });

  it('limits value length', () => {
    expect(customValuesSchema.safeParse({ c1: 'x'.repeat(1001) }).success).toBe(false);
    expect(customValuesSchema.safeParse({ c1: 1 }).success).toBe(false);
  });

  it('reads stored JSON defensively', () => {
    expect(parseCustomColumns(null)).toEqual([]);
    expect(parseCustomColumns([{ id: 'c1', name: 'Client' }, { id: 2 }, 'x'])).toEqual([
      { id: 'c1', name: 'Client' },
    ]);
    expect(parseCustomValues([])).toEqual({});
    expect(parseCustomValues({ c1: 'Acme', c2: 3 })).toEqual({ c1: 'Acme' });
  });
});
