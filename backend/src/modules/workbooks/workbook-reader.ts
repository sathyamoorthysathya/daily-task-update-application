import ExcelJS from 'exceljs';
import { DAILY_TASK_COLUMNS, DAILY_TASKS_SHEET_NAME } from './workbook.constants.js';

/** A data row of the "Daily Tasks" sheet, with its internal references. */
export interface WorkbookRow {
  taskId: string;
  taskUpdateId: string;
  taskNumber: number;
  date: string;
  taskName: string;
  description: string;
  reference: string;
  status: string;
}

const TASK_ID_COLUMN = DAILY_TASK_COLUMNS.length + 1; // G
const UPDATE_ID_COLUMN = DAILY_TASK_COLUMNS.length + 2; // H

/** Reads the data rows of a workbook file (used for verification and diagnostics). */
export async function readWorkbookRows(file: Buffer): Promise<WorkbookRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(DAILY_TASKS_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Worksheet "${DAILY_TASKS_SHEET_NAME}" is missing`);
  }
  const rows: WorkbookRow[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) {
      return;
    }
    const date = row.getCell(2).value;
    rows.push({
      taskId: row.getCell(TASK_ID_COLUMN).text,
      taskUpdateId: row.getCell(UPDATE_ID_COLUMN).text,
      taskNumber: Number(row.getCell(1).value),
      date: date instanceof Date ? date.toISOString().slice(0, 10) : row.getCell(2).text,
      taskName: row.getCell(3).text,
      description: row.getCell(4).text,
      reference: row.getCell(5).text,
      status: row.getCell(6).text,
    });
  });
  return rows;
}
