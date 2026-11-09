import {
  addTaskUpdateSchema,
  createTaskSchema,
  editTaskUpdateSchema,
  entryDateSchema,
  taskNameKey,
  taskNameSchema,
} from './tasks.schemas.js';

const valid = {
  name: 'Prepare GST report',
  entryDate: '2026-11-07',
  description: 'Collected invoices for October.',
  reference: 'https://docs.example.com/gst',
  status: 'IN_PROGRESS',
};

describe('task names', () => {
  it('normalise whitespace and compare case-insensitively', () => {
    expect(taskNameSchema.parse('  Prepare   GST\treport ')).toBe('Prepare GST report');
    expect(taskNameKey(' PREPARE  gst Report')).toBe(taskNameKey('prepare gst report'));
  });

  it('treat composed and decomposed Unicode as the same name', () => {
    expect(taskNameKey('Caf\u00e9 review')).toBe(taskNameKey('Cafe\u0301 review'));
  });

  it('reject empty and over-long names', () => {
    expect(taskNameSchema.safeParse('   ').success).toBe(false);
    expect(taskNameSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

describe('entryDateSchema', () => {
  it.each(['2026-11-07', '2000-01-01', '2024-02-29'])('accepts %s', (date) => {
    expect(entryDateSchema.safeParse(date).success).toBe(true);
  });

  it.each([
    ['a malformed date', '07/11/2026'],
    ['an impossible date', '2026-02-30'],
    ['a date before 2000', '1999-12-31'],
    ['a date more than a year ahead', `${new Date().getUTCFullYear() + 2}-01-01`],
  ])('rejects %s', (_case, date) => {
    expect(entryDateSchema.safeParse(date).success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  it('accepts a complete task and keeps an optional workbook', () => {
    expect(createTaskSchema.parse(valid)).toEqual(valid);
    expect(createTaskSchema.safeParse({ ...valid, workbookId: 'not-a-uuid' }).success).toBe(false);
  });

  it('treats an empty reference as none', () => {
    expect(createTaskSchema.parse({ ...valid, reference: '  ' }).reference).toBeNull();
    expect(createTaskSchema.parse({ ...valid, reference: undefined }).reference).toBeNull();
  });

  it('allows plain-text references but only http(s) links', () => {
    expect(createTaskSchema.safeParse({ ...valid, reference: 'Ticket JIRA-123' }).success).toBe(
      true,
    );
    for (const reference of ['javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,x']) {
      expect(createTaskSchema.safeParse({ ...valid, reference }).success).toBe(false);
    }
  });

  it('accepts only the five statuses', () => {
    for (const status of ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD']) {
      expect(createTaskSchema.safeParse({ ...valid, status }).success).toBe(true);
    }
    expect(createTaskSchema.safeParse({ ...valid, status: 'DONE' }).success).toBe(false);
  });

  it('requires a description and rejects unknown fields', () => {
    expect(createTaskSchema.safeParse({ ...valid, description: ' ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...valid, taskNumber: 99 }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...valid, userId: 'x' }).success).toBe(false);
  });
});

describe('update schemas', () => {
  it('a new daily entry has no name or workbook', () => {
    const entry = {
      entryDate: valid.entryDate,
      description: valid.description,
      status: valid.status,
    };
    expect(addTaskUpdateSchema.safeParse(entry).success).toBe(true);
    expect(addTaskUpdateSchema.safeParse(valid).success).toBe(false);
  });

  it('editing requires a version and cannot change the date', () => {
    const edit = { description: 'x', reference: null, status: 'COMPLETED', version: 1 };
    expect(editTaskUpdateSchema.safeParse(edit).success).toBe(true);
    expect(editTaskUpdateSchema.safeParse({ ...edit, version: undefined }).success).toBe(false);
    expect(editTaskUpdateSchema.safeParse({ ...edit, entryDate: '2026-01-01' }).success).toBe(
      false,
    );
  });
});
