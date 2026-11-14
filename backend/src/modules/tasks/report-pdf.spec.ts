import { writeFile } from 'node:fs/promises';
import type { ReportEntryDto, TaskDto, TaskReportDto } from './dto/task.dto.js';
import { buildReportPdf } from './report-pdf.js';

const TASK: TaskDto = {
  id: 'task-1',
  workbookId: 'wb-1',
  taskNumber: 1,
  name: 'Prepare GST report',
  status: 'COMPLETED',
  lastEntryDate: '2026-11-20',
  entryCount: 20,
  assignedBy: 'Priya (Team Lead)',
  priority: 'HIGH',
  project: 'Billing module',
  dueDate: '2026-11-25',
  version: 1,
  createdAt: '2026-11-01T09:00:00.000Z',
};

function entry(day: number, overrides: Partial<ReportEntryDto> = {}): ReportEntryDto {
  const date = `2026-11-${String(day).padStart(2, '0')}`;
  return {
    id: `upd-${day}`,
    taskId: TASK.id,
    entryDate: date,
    status: day === 20 ? 'COMPLETED' : 'IN_PROGRESS',
    description:
      `Day ${day}: reconciled invoices against the ledger and fixed the differences. `.repeat(
        day % 3 === 0 ? 4 : 1,
      ),
    reference: day % 4 === 0 ? 'https://docs.example.com/gst' : null,
    startTime: '09:30',
    endTime: '13:15',
    minutesWorked: 225,
    remarks: day % 5 === 0 ? 'Waiting for the October invoices from accounts.' : null,
    version: 1,
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T13:15:00.000Z`,
    task: TASK,
    workbookName: 'Daily Tasks',
    ...overrides,
  };
}

const LONG: TaskReportDto = {
  from: '2026-11-01',
  to: '2026-11-30',
  totals: {
    entries: 20,
    tasks: 1,
    completedTasks: 1,
    daysWorked: 20,
    minutesWorked: 4500,
    entriesWithoutTime: 0,
  },
  entries: Array.from({ length: 20 }, (_, i) => entry(i + 1)),
  truncated: false,
};

const INFO = {
  userName: 'Jane Doe',
  periodLabel: '',
  generatedAt: new Date('2026-11-30T10:00:00Z'),
};

/** Page objects in the file ("/Type /Page", not "/Type /Pages"). */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g)?.length;

describe('buildReportPdf', () => {
  it('builds a multi-page PDF for a month of entries', async () => {
    const pdf = await buildReportPdf(LONG, INFO);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThan(1);
    // Set REPORT_PDF_SAMPLE to a file path to look at the result.
    if (process.env.REPORT_PDF_SAMPLE) {
      await writeFile(process.env.REPORT_PDF_SAMPLE, pdf);
    }
  });

  it('builds a one-page PDF for an empty period', async () => {
    const pdf = await buildReportPdf(
      {
        ...LONG,
        from: null,
        to: null,
        entries: [],
        totals: { ...LONG.totals, entries: 0, tasks: 0 },
      },
      INFO,
    );

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });
});
