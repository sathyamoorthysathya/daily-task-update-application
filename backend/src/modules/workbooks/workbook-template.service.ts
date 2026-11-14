import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { TaskPriority, TaskStatus } from '../../generated/prisma/client.js';
import { TASK_STATUSES, taskStatusLabel } from '../tasks/task-status.js';
import {
  DAILY_TASK_COLUMNS,
  DAILY_TASKS_SHEET_NAME,
  INTERNAL_ID_COLUMNS,
  LAST_COLUMN,
  WORK_DETAIL_COLUMNS,
} from './workbook.constants.js';

const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const HEADER_FILL = 'FF1F3A93';
const HEADER_FONT = 'FFFFFFFF';
const BORDER_COLOR = 'FFBFC7D5';
const LINK_COLOR = 'FF1F4FD8';

/** Light background per status so the sheet is easy to scan. */
const STATUS_FILL: Record<TaskStatus, string> = {
  TO_DO: 'FFEDEFF3',
  IN_PROGRESS: 'FFDCE8FF',
  PENDING: 'FFFFF1CC',
  COMPLETED: 'FFDDF3E4',
  ON_HOLD: 'FFFBE0E0',
};

/** One row of the "Daily Tasks" sheet (one dated task update). */
export interface DailyTaskRow {
  /** Internal row references (hidden columns G-H). */
  taskId: string;
  taskUpdateId: string;
  taskNumber: number;
  /** Calendar date at UTC midnight. */
  date: Date;
  taskName: string;
  description: string;
  reference: string | null;
  status: TaskStatus;
  /** Work details (columns I-P); all optional. */
  project?: string | null;
  assignedBy?: string | null;
  priority?: TaskPriority | null;
  /** Calendar date at UTC midnight. */
  dueDate?: Date | null;
  /** Wall-clock "HH:MM". */
  startTime?: string | null;
  endTime?: string | null;
  remarks?: string | null;
}

const thin = { style: 'thin' as const, color: { argb: BORDER_COLOR } };

/**
 * ExcelJS supports range-wide data validation at runtime (one rule for a whole range instead of
 * one per cell), but its type definitions do not declare it.
 */
interface WorksheetWithValidations {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
}

/** Builds .xlsx workbooks with the "Daily Tasks" worksheet, optionally filled with rows. */
@Injectable()
export class WorkbookTemplateService {
  async createDailyTasksWorkbook(
    title: string,
    rows: readonly DailyTaskRow[] = [],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const now = new Date();
    workbook.creator = 'Daily Task Update';
    workbook.lastModifiedBy = 'Daily Task Update';
    workbook.created = now;
    workbook.modified = now;
    workbook.title = title;

    const sheet = workbook.addWorksheet(DAILY_TASKS_SHEET_NAME, {
      // Freeze the header row so it stays visible while scrolling.
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }],
      properties: { defaultRowHeight: 18 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    sheet.columns = [
      ...DAILY_TASK_COLUMNS.map((column) => ({
        key: column.key,
        header: column.header,
        width: column.width,
      })),
      ...INTERNAL_ID_COLUMNS.map((column) => ({
        key: column.key,
        header: column.header,
        width: column.width,
        hidden: true,
      })),
      ...WORK_DETAIL_COLUMNS.map((column) => ({
        key: column.key,
        header: column.header,
        width: column.width,
      })),
    ];

    // Column formats for the data rows.
    sheet.getColumn('taskNumber').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('date').numFmt = 'yyyy-mm-dd';
    sheet.getColumn('date').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('taskName').alignment = { vertical: 'top', wrapText: true };
    sheet.getColumn('taskDescription').alignment = { vertical: 'top', wrapText: true };
    sheet.getColumn('reference').alignment = { vertical: 'top', wrapText: true };
    sheet.getColumn('status').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('project').alignment = { vertical: 'top', wrapText: true };
    sheet.getColumn('assignedBy').alignment = { vertical: 'top', wrapText: true };
    sheet.getColumn('priority').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('dueDate').numFmt = 'yyyy-mm-dd';
    sheet.getColumn('dueDate').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('startTime').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('endTime').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('hoursWorked').numFmt = '0.00';
    sheet.getColumn('hoursWorked').alignment = { horizontal: 'center', vertical: 'top' };
    sheet.getColumn('remarks').alignment = { vertical: 'top', wrapText: true };

    const header = sheet.getRow(1);
    header.height = 24;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thin, bottom: { ...thin, style: 'medium' }, left: thin, right: thin };
    });

    // Each task update is exactly one row: refuse to write a sheet with a duplicated reference.
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.taskUpdateId)) {
        throw new Error(`Duplicate row for task update ${row.taskUpdateId}`);
      }
      seen.add(row.taskUpdateId);
    }

    for (const row of rows) {
      this.addRow(sheet, row);
    }

    // Status drop-down for every data row, including rows added later in Excel.
    (sheet as unknown as WorksheetWithValidations).dataValidations.add('F2:F10000', {
      type: 'list',
      allowBlank: true,
      formulae: [`"${TASK_STATUSES.map((status) => status.label).join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid status',
      error: 'Choose a status from the list.',
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: LAST_COLUMN },
    };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private addRow(sheet: ExcelJS.Worksheet, row: DailyTaskRow): void {
    const excelRow = sheet.addRow({
      taskNumber: row.taskNumber,
      date: row.date,
      taskName: row.taskName,
      // Plain strings are stored as text, never as formulas.
      taskDescription: row.description,
      reference: row.reference ?? '',
      status: taskStatusLabel(row.status),
      taskId: row.taskId,
      taskUpdateId: row.taskUpdateId,
      // Plain strings again: user text is never written as a formula.
      project: row.project ?? '',
      assignedBy: row.assignedBy ?? '',
      priority: row.priority ? PRIORITY_LABEL[row.priority] : '',
      dueDate: row.dueDate ?? '',
      startTime: row.startTime ?? '',
      endTime: row.endTime ?? '',
      // A number, so the column can be summed in Excel.
      hoursWorked:
        row.startTime && row.endTime
          ? Math.round(((toMinutes(row.endTime) - toMinutes(row.startTime)) / 60) * 100) / 100
          : '',
      remarks: row.remarks ?? '',
    });
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: thin, bottom: thin, left: thin, right: thin };
    });

    // Only web links become clickable; anything else stays plain text.
    if (row.reference && /^https?:\/\//i.test(row.reference)) {
      const cell = excelRow.getCell('reference');
      cell.value = { text: row.reference, hyperlink: row.reference };
      cell.font = { color: { argb: LINK_COLOR }, underline: true };
    }

    excelRow.getCell('status').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_FILL[row.status] },
    };
  }
}
