import ExcelJS from 'exceljs';
import type { TaskReportDto } from './dto/task.dto.js';
import { taskStatusLabel } from './task-status.js';
import type { TaskStatus } from '../../generated/prisma/client.js';

const HEADER_FILL = 'FF1F3A93';
const HEADER_FONT = 'FFFFFFFF';
const BORDER_COLOR = 'FFBFC7D5';
const DAY_FILL = 'FFEAEEFE';

const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

const thin = { style: 'thin' as const, color: { argb: BORDER_COLOR } };
const boxed = { top: thin, bottom: thin, left: thin, right: thin };

/** Calendar date "YYYY-MM-DD" → a date cell (UTC midnight, shown as a plain date). */
const dateCell = (value: string | null) => (value ? new Date(`${value}T00:00:00.000Z`) : '');

/** Minutes → hours with two decimals, as a number so the column can be summed in Excel. */
const hours = (minutes: number | null) =>
  minutes === null ? '' : Math.round((minutes / 60) * 100) / 100;

export interface ReportWorkbookInfo {
  /** Name of the person the report is about. */
  userName: string;
  /** "Nov 1, 2026 – Nov 30, 2026" or "All work to date". */
  periodLabel: string;
  generatedAt: Date;
}

/** "From 2026-11-01 to 2026-11-30", "All work to date", ... (plain, locale-independent). */
export function reportPeriodLabel(from: string | null, to: string | null): string {
  if (from && to) {
    return `${from} to ${to}`;
  }
  if (from) {
    return `From ${from}`;
  }
  return to ? `Up to ${to}` : 'All work to date';
}

/** File name of a downloaded report, e.g. "Work report 2026-11-01 to 2026-11-30". */
export function reportFileName(from: string | null, to: string | null): string {
  if (!from && !to) {
    return 'Work report - all work';
  }
  return `Work report ${reportPeriodLabel(from, to).replace(/^(From|Up to) /, (m) => m.toLowerCase())}`;
}

function styleHeader(sheet: ExcelJS.Worksheet, rowNumber = 1): void {
  const header = sheet.getRow(rowNumber);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = boxed;
  });
}

/**
 * The work report as an .xlsx file: a Summary sheet (who, which period, totals), a Tasks sheet
 * (one row per task worked on) and a Daily log sheet (one row per daily entry, oldest first).
 * User text is always written as plain text, never as a formula.
 */
export async function buildReportWorkbook(
  report: TaskReportDto,
  info: ReportWorkbookInfo,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Daily Task Update';
  workbook.created = info.generatedAt;
  workbook.title = `Work report - ${info.userName}`;

  // ---------------------------------------------------------------- Summary
  const summary = workbook.addWorksheet('Summary', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  summary.columns = [{ width: 26 }, { width: 44 }];
  summary.addRow(['Work report']).font = { bold: true, size: 16 };
  summary.addRow([]);
  const facts: [string, string | number][] = [
    ['Name', info.userName],
    ['Period', info.periodLabel],
    ['Generated', info.generatedAt.toISOString().slice(0, 10)],
  ];
  const totals: [string, string | number][] = [
    ['Tasks worked on', report.totals.tasks],
    ['Tasks completed', report.totals.completedTasks],
    ['Daily entries', report.totals.entries],
    ['Days worked', report.totals.daysWorked],
    ['Hours recorded', hours(report.totals.minutesWorked) || 0],
    ['Entries without times', report.totals.entriesWithoutTime],
  ];
  for (const [label, value] of facts) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  summary.addRow([]);
  summary.addRow(['Totals']).font = { bold: true, size: 12 };
  for (const [label, value] of totals) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { horizontal: 'left' };
    row.eachCell((cell) => {
      cell.border = boxed;
    });
  }
  if (report.truncated) {
    summary.addRow([]);
    summary.addRow([
      'Note',
      `Only the first ${report.entries.length} entries are included; choose a shorter period for a complete report.`,
    ]).font = { italic: true };
  }

  // ---------------------------------------------------------------- Tasks
  const tasks = workbook.addWorksheet('Tasks', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  tasks.columns = [
    { header: 'Task #', key: 'number', width: 9 },
    { header: 'Task', key: 'name', width: 36 },
    { header: 'Project / Module', key: 'project', width: 22 },
    { header: 'Assigned By', key: 'assignedBy', width: 22 },
    { header: 'Priority', key: 'priority', width: 11 },
    { header: 'Due Date', key: 'dueDate', width: 13, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'First Day', key: 'firstDay', width: 13, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Last Day', key: 'lastDay', width: 13, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Hours', key: 'hours', width: 9, style: { numFmt: '0.00' } },
    { header: 'Status', key: 'status', width: 14 },
  ];
  styleHeader(tasks);

  const byTask = new Map<
    string,
    { entry: TaskReportDto['entries'][number]; days: number; minutes: number; last: string }
  >();
  for (const entry of report.entries) {
    const current = byTask.get(entry.taskId);
    if (current) {
      current.days += 1;
      current.minutes += entry.minutesWorked ?? 0;
      current.last = entry.entryDate;
    } else {
      byTask.set(entry.taskId, {
        entry,
        days: 1,
        minutes: entry.minutesWorked ?? 0,
        last: entry.entryDate,
      });
    }
  }
  const taskRows = [...byTask.values()].sort(
    (a, b) => a.entry.task.taskNumber - b.entry.task.taskNumber,
  );
  for (const { entry, days, minutes, last } of taskRows) {
    const { task } = entry;
    const row = tasks.addRow({
      number: task.taskNumber,
      name: task.name,
      project: task.project ?? '',
      assignedBy: task.assignedBy ?? '',
      priority: task.priority ? (PRIORITY_LABEL[task.priority] ?? task.priority) : '',
      dueDate: dateCell(task.dueDate),
      firstDay: dateCell(entry.entryDate),
      lastDay: dateCell(last),
      days,
      hours: minutes > 0 ? hours(minutes) : '',
      status: taskStatusLabel(task.status as TaskStatus),
    });
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = boxed;
    });
  }
  tasks.autoFilter = { from: 'A1', to: { row: Math.max(1, taskRows.length + 1), column: 11 } };

  // ---------------------------------------------------------------- Daily log
  const log = workbook.addWorksheet('Daily log', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  log.columns = [
    { header: 'Date', key: 'date', width: 13, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Task #', key: 'number', width: 9 },
    { header: 'Task', key: 'name', width: 30 },
    { header: 'Project / Module', key: 'project', width: 20 },
    { header: 'Work Done', key: 'description', width: 54 },
    { header: 'Start', key: 'start', width: 9 },
    { header: 'End', key: 'end', width: 9 },
    { header: 'Hours', key: 'hours', width: 9, style: { numFmt: '0.00' } },
    { header: 'Remarks / Blockers', key: 'remarks', width: 36 },
    { header: 'Reference', key: 'reference', width: 30 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  styleHeader(log);
  let previousDate: string | null = null;
  let shaded = false;
  for (const entry of report.entries) {
    if (entry.entryDate !== previousDate) {
      shaded = !shaded;
      previousDate = entry.entryDate;
    }
    const row = log.addRow({
      date: dateCell(entry.entryDate),
      number: entry.task.taskNumber,
      name: entry.task.name,
      project: entry.task.project ?? '',
      description: entry.description,
      start: entry.startTime ?? '',
      end: entry.endTime ?? '',
      hours: hours(entry.minutesWorked),
      remarks: entry.remarks ?? '',
      reference: entry.reference ?? '',
      status: taskStatusLabel(entry.status as TaskStatus),
    });
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = boxed;
      // Alternate the background per day so each day's entries read as one block.
      if (shaded) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DAY_FILL } };
      }
    });
  }
  log.autoFilter = { from: 'A1', to: { row: Math.max(1, report.entries.length + 1), column: 11 } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
