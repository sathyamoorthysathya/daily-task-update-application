import { workbookContentDisposition } from './content-disposition.js';
import {
  createWorkbookSchema,
  renameWorkbookSchema,
  workbookNameSchema,
} from './workbooks.schemas.js';

describe('workbookNameSchema', () => {
  it('trims and collapses whitespace', () => {
    expect(workbookNameSchema.parse('  Q1   Daily  Tasks ')).toBe('Q1 Daily Tasks');
  });

  it.each([
    ['empty', '   '],
    ['too long', 'x'.repeat(101)],
    ['a slash', 'reports/2026'],
    ['a backslash', '..\\..\\secret'],
    ['a colon', 'C:tasks'],
    ['quotes', 'my "tasks"'],
    ['angle brackets', '<script>'],
    ['a control character', 'tasks\u0007'],
  ])('rejects a name with %s', (_case, name) => {
    expect(workbookNameSchema.safeParse(name).success).toBe(false);
  });

  it('accepts Unicode names', () => {
    expect(workbookNameSchema.parse('தினசரி பணிகள் 2026')).toBe('தினசரி பணிகள் 2026');
  });
});

describe('workbook request schemas', () => {
  it('rejects unknown fields', () => {
    expect(createWorkbookSchema.safeParse({ name: 'A', storageKey: '../x' }).success).toBe(false);
  });

  it('requires a version to rename', () => {
    expect(renameWorkbookSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(renameWorkbookSchema.safeParse({ name: 'A', version: 2 }).success).toBe(true);
  });
});

describe('workbookContentDisposition', () => {
  it('produces an attachment header with ASCII and UTF-8 file names', () => {
    expect(workbookContentDisposition('Daily Tasks')).toBe(
      `attachment; filename="Daily Tasks.xlsx"; filename*=UTF-8''Daily%20Tasks.xlsx`,
    );
    expect(workbookContentDisposition('Café (Q1)')).toBe(
      `attachment; filename="Caf_ (Q1).xlsx"; filename*=UTF-8''Caf%C3%A9%20%28Q1%29.xlsx`,
    );
  });

  it('cannot be used to inject header content', () => {
    const header = workbookContentDisposition('evil"\r\nSet-Cookie: x=1');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith('attachment; filename="evil_')).toBe(true);
  });
});
