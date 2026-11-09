import ExcelJS from 'exceljs';
import { WorkbookTemplateService } from './workbook-template.service.js';

async function load(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('WorkbookTemplateService', () => {
  const service = new WorkbookTemplateService();

  it('creates a single "Daily Tasks" worksheet with the six columns A-F', async () => {
    const workbook = await load(await service.createDailyTasksWorkbook('My Tasks'));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Daily Tasks']);
    const sheet = workbook.getWorksheet('Daily Tasks')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'Task Number',
      'Date',
      'Task Name',
      'Task Description',
      'Documentation Link / Reference',
      'Status',
      'Task ID (internal)',
      'Task Update ID (internal)',
    ]);
    expect(sheet.rowCount).toBe(1);
    expect(workbook.title).toBe('My Tasks');
  });

  it('keeps the internal row references in hidden columns G and H', async () => {
    const sheet = (await load(await service.createDailyTasksWorkbook('x'))).getWorksheet(
      'Daily Tasks',
    )!;

    expect(sheet.getColumn(7).hidden).toBe(true);
    expect(sheet.getColumn(8).hidden).toBe(true);
    expect([1, 2, 3, 4, 5, 6].some((c) => sheet.getColumn(c).hidden)).toBe(false);
  });

  it('refuses to write two rows for the same task update', async () => {
    const row = {
      taskId: 'task-1',
      taskUpdateId: 'update-1',
      taskNumber: 1,
      date: new Date('2026-11-06T00:00:00.000Z'),
      taskName: 'Prepare report',
      description: 'Draft',
      reference: '',
      status: 'TO_DO' as const,
    };

    await expect(service.createDailyTasksWorkbook('x', [row, { ...row }])).rejects.toThrow(
      'Duplicate row for task update update-1',
    );
  });

  it('formats the header row', async () => {
    const sheet = (await load(await service.createDailyTasksWorkbook('x'))).getWorksheet(
      'Daily Tasks',
    )!;

    for (let column = 1; column <= 6; column += 1) {
      const cell = sheet.getRow(1).getCell(column);
      expect(cell.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
      expect(cell.fill).toMatchObject({
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F3A93' },
      });
      expect(cell.alignment).toMatchObject({ horizontal: 'center', vertical: 'middle' });
    }
  });

  it('sets column widths, filters and a frozen header row', async () => {
    const sheet = (await load(await service.createDailyTasksWorkbook('x'))).getWorksheet(
      'Daily Tasks',
    )!;

    expect([1, 2, 3, 4, 5, 6].map((c) => sheet.getColumn(c).width)).toEqual([
      14, 14, 32, 60, 42, 16,
    ]);
    expect(sheet.autoFilter).toBe('A1:F1');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, topLeftCell: 'A2' });
    expect(sheet.getColumn(2).numFmt).toBe('yyyy-mm-dd');
    expect(sheet.getColumn(4).alignment).toMatchObject({ wrapText: true });
  });

  it('writes task rows with dates, links, statuses and filters', async () => {
    const buffer = await service.createDailyTasksWorkbook('x', [
      {
        taskId: 'task-1',
        taskUpdateId: 'update-1',
        taskNumber: 1,
        date: new Date('2026-11-06T00:00:00.000Z'),
        taskName: 'Prepare report',
        description: '=HYPERLINK("http://evil.example")',
        reference: 'https://docs.example.com/report',
        status: 'IN_PROGRESS',
      },
      {
        taskId: 'task-1',
        taskUpdateId: 'update-2',
        taskNumber: 1,
        date: new Date('2026-11-07T00:00:00.000Z'),
        taskName: 'Prepare report',
        description: 'Finished',
        reference: 'Ticket JIRA-12',
        status: 'COMPLETED',
      },
    ]);
    const sheet = (await load(buffer)).getWorksheet('Daily Tasks')!;

    expect(sheet.rowCount).toBe(3);
    const first = sheet.getRow(2);
    expect(first.getCell(1).value).toBe(1);
    expect(first.getCell(2).value).toEqual(new Date('2026-11-06T00:00:00.000Z'));
    expect(first.getCell(3).value).toBe('Prepare report');
    // Text that looks like a formula is stored as plain text, never as a formula.
    expect(first.getCell(4).value).toBe('=HYPERLINK("http://evil.example")');
    expect(first.getCell(4).formula).toBeUndefined();
    expect(first.getCell(5).value).toEqual({
      text: 'https://docs.example.com/report',
      hyperlink: 'https://docs.example.com/report',
    });
    expect(first.getCell(6).value).toBe('In Progress');
    expect(first.getCell(6).fill).toMatchObject({ fgColor: { argb: 'FFDCE8FF' } });

    const second = sheet.getRow(3);
    expect(second.getCell(5).value).toBe('Ticket JIRA-12');
    expect(second.getCell(6).value).toBe('Completed');
    expect(first.getCell(7).value).toBe('task-1');
    expect(first.getCell(8).value).toBe('update-1');
    expect(second.getCell(8).value).toBe('update-2');

    expect(sheet.autoFilter).toBe('A1:F3');
    expect(sheet.getCell('F2').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"To Do,In Progress,Pending,Completed,On Hold"'],
    });
  });
});
