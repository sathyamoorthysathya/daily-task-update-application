import {
  addTaskUpdateSchema,
  createTaskSchema,
  editTaskUpdateSchema,
  entryDateSchema,
  renameTaskSchema,
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

/** Work details are optional: left out, they are stored as "none". */
const noDetails = {
  assignedBy: null,
  priority: null,
  project: null,
  dueDate: null,
  startTime: null,
  endTime: null,
  remarks: null,
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
    expect(createTaskSchema.parse(valid)).toEqual({ ...valid, ...noDetails });
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

describe('work details', () => {
  it('accepts who assigned the task, priority, project, due date, hours and remarks', () => {
    const parsed = createTaskSchema.parse({
      ...valid,
      assignedBy: '  Priya   (Team Lead) ',
      priority: 'HIGH',
      project: 'Billing module',
      dueDate: '2026-11-20',
      startTime: '09:30',
      endTime: '13:15',
      remarks: '  Waiting for invoices ',
    });
    expect(parsed).toMatchObject({
      assignedBy: 'Priya (Team Lead)',
      priority: 'HIGH',
      project: 'Billing module',
      dueDate: '2026-11-20',
      startTime: '09:30',
      endTime: '13:15',
      remarks: 'Waiting for invoices',
    });
  });

  it('treats empty details as none', () => {
    const parsed = createTaskSchema.parse({ ...valid, assignedBy: ' ', project: '', remarks: '' });
    expect(parsed).toMatchObject({ assignedBy: null, project: null, remarks: null });
  });

  it.each([
    ['an unknown priority', { priority: 'URGENT' }],
    ['an impossible due date', { dueDate: '2026-02-30' }],
    ['a malformed time', { startTime: '9:30' }],
    ['a time past midnight', { startTime: '24:00' }],
    ['an end time without a start time', { endTime: '13:00' }],
    ['an end time before the start time', { startTime: '13:00', endTime: '09:00' }],
    ['an end time equal to the start time', { startTime: '13:00', endTime: '13:00' }],
    ['an over-long name', { assignedBy: 'x'.repeat(101) }],
  ])('rejects %s', (_case, fields) => {
    expect(createTaskSchema.safeParse({ ...valid, ...fields }).success).toBe(false);
  });

  it('allows a start time on its own (work still in progress)', () => {
    expect(createTaskSchema.safeParse({ ...valid, startTime: '09:30' }).success).toBe(true);
  });

  it('checks the working hours of new and edited entries too', () => {
    const entry = { entryDate: valid.entryDate, description: 'x', status: 'TO_DO' };
    expect(addTaskUpdateSchema.safeParse({ ...entry, endTime: '10:00' }).success).toBe(false);
    const edit = { description: 'x', status: 'TO_DO', version: 1 };
    expect(
      editTaskUpdateSchema.safeParse({ ...edit, startTime: '10:00', endTime: '09:00' }).success,
    ).toBe(false);
    expect(
      editTaskUpdateSchema.parse({ ...edit, startTime: '09:00', endTime: '10:00', remarks: 'ok' }),
    ).toMatchObject({ startTime: '09:00', endTime: '10:00', remarks: 'ok' });
  });

  it('changes only the task details that are sent', () => {
    const renamed = renameTaskSchema.parse({ name: 'New name', version: 2 });
    expect(renamed).toEqual({ name: 'New name', version: 2 });
    expect(
      renameTaskSchema.parse({ name: 'x', version: 1, assignedBy: '', priority: null }),
    ).toEqual({ name: 'x', version: 1, assignedBy: null, priority: null });
    expect(renameTaskSchema.safeParse({ name: 'x', version: 1, priority: 'TOP' }).success).toBe(
      false,
    );
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
