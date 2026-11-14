import PDFDocument from 'pdfkit';
import type { TaskStatus } from '../../generated/prisma/client.js';
import type { ReportEntryDto, TaskReportDto } from './dto/task.dto.js';
import { taskStatusLabel } from './task-status.js';
import type { ReportWorkbookInfo } from './report-workbook.js';

type Doc = PDFKit.PDFDocument;

const MARGIN = 36;
const INK = '#1c2230';
const MUTED = '#5d6677';
const BORDER = '#d5dae2';
const HEADER_BG = '#1f3a93';
const DAY_BG = '#eaeefe';
const REMARK_BG = '#fff6df';

const STATUS_COLORS: Record<TaskStatus, { bg: string; fg: string }> = {
  TO_DO: { bg: '#eceff3', fg: '#4a5262' },
  IN_PROGRESS: { bg: '#dce8ff', fg: '#1f4fd8' },
  PENDING: { bg: '#fff1cc', fg: '#8a5a00' },
  COMPLETED: { bg: '#ddf3e4', fg: '#17703a' },
  ON_HOLD: { bg: '#fde8e8', fg: '#b42323' },
};

const PRIORITY_LABEL: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

/** "Nov 5, 2026" for a calendar date "YYYY-MM-DD". */
function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function weekday(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

/** "09:30" → "9:30 AM" */
function formatClock(time: string): string {
  const hour = Number(time.slice(0, 2));
  return `${hour % 12 === 0 ? 12 : hour % 12}:${time.slice(3, 5)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "45 min", "3 h", "3 h 45 min" */
function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** One cell: lines of text, each with its own style. */
interface Line {
  text: string;
  bold?: boolean;
  muted?: boolean;
  size?: number;
  /** Shaded box behind the line (remarks). */
  note?: boolean;
}

type Cell = Line[] | { status: TaskStatus };

interface Column {
  header: string;
  width: number;
}

const CELL_PAD_X = 6;
const CELL_PAD_Y = 6;
const LINE_GAP = 2;

function lineFont(doc: Doc, line: Line): void {
  doc.font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(line.size ?? 9);
}

function cellHeight(doc: Doc, cell: Cell, width: number): number {
  if ('status' in cell) {
    return 16;
  }
  let height = 0;
  for (const line of cell) {
    lineFont(doc, line);
    height += doc.heightOfString(line.text, { width: width - (line.note ? 8 : 0) }) + LINE_GAP;
    if (line.note) {
      height += 6;
    }
  }
  return Math.max(height - LINE_GAP, 10);
}

function drawCell(doc: Doc, cell: Cell, x: number, y: number, width: number): void {
  if ('status' in cell) {
    const label = taskStatusLabel(cell.status);
    const colors = STATUS_COLORS[cell.status];
    doc.font('Helvetica-Bold').fontSize(8);
    const pillWidth = doc.widthOfString(label) + 14;
    doc.roundedRect(x, y, pillWidth, 15, 7.5).fill(colors.bg);
    doc.fillColor(colors.fg).text(label, x + 7, y + 4, { lineBreak: false });
    return;
  }
  let cursor = y;
  for (const line of cell) {
    lineFont(doc, line);
    if (line.note) {
      const height = doc.heightOfString(line.text, { width: width - 8 });
      doc.rect(x, cursor, width, height + 6).fill(REMARK_BG);
      doc.rect(x, cursor, 2, height + 6).fill('#f0a429');
      doc.fillColor(INK).text(line.text, x + 6, cursor + 3, { width: width - 8 });
      cursor += height + 6 + LINE_GAP;
    } else {
      doc.fillColor(line.muted ? MUTED : INK).text(line.text, x, cursor, { width });
      cursor += doc.heightOfString(line.text, { width }) + LINE_GAP;
    }
  }
}

/** Starts a new page when `needed` points do not fit; returns true if it did. */
function ensureSpace(doc: Doc, needed: number): boolean {
  if (doc.y + needed > doc.page.height - MARGIN - 18) {
    doc.addPage();
    return true;
  }
  return false;
}

function drawTableHeader(doc: Doc, columns: Column[]): void {
  const y = doc.y;
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  doc.rect(MARGIN, y, width, 20).fill(HEADER_BG);
  let x = MARGIN;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  for (const column of columns) {
    doc.text(column.header.toUpperCase(), x + CELL_PAD_X, y + 6.5, {
      width: column.width - CELL_PAD_X * 2,
      lineBreak: false,
      characterSpacing: 0.4,
    });
    x += column.width;
  }
  doc.y = y + 20;
}

/**
 * A table that breaks across pages: the header row is repeated on every page, and a row is
 * never split. `band` rows (a day heading) span all columns.
 */
function drawTable(
  doc: Doc,
  columns: Column[],
  rows: ({ cells: Cell[] } | { band: string; meta: string })[],
): void {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  ensureSpace(doc, 60);
  drawTableHeader(doc, columns);

  rows.forEach((row, index) => {
    if ('band' in row) {
      // Keep a day heading together with its first entry.
      const next = rows[index + 1];
      const nextHeight =
        next && 'cells' in next
          ? Math.max(
              ...next.cells.map((cell, i) =>
                cellHeight(doc, cell, columns[i]!.width - CELL_PAD_X * 2),
              ),
            ) +
            CELL_PAD_Y * 2
          : 0;
      if (ensureSpace(doc, 22 + nextHeight)) {
        drawTableHeader(doc, columns);
      }
      const y = doc.y;
      doc.rect(MARGIN, y, width, 20).fill(DAY_BG);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
      doc.text(row.band, MARGIN + CELL_PAD_X, y + 6, { continued: true, lineBreak: false });
      doc.font('Helvetica').fillColor(MUTED).text(`   ${row.meta}`, { lineBreak: false });
      doc.y = y + 20;
      return;
    }

    const height =
      Math.max(
        ...row.cells.map((cell, i) => cellHeight(doc, cell, columns[i]!.width - CELL_PAD_X * 2)),
      ) +
      CELL_PAD_Y * 2;
    if (ensureSpace(doc, height)) {
      drawTableHeader(doc, columns);
    }
    const y = doc.y;
    let x = MARGIN;
    row.cells.forEach((cell, i) => {
      const column = columns[i]!;
      drawCell(doc, cell, x + CELL_PAD_X, y + CELL_PAD_Y, column.width - CELL_PAD_X * 2);
      x += column.width;
    });
    doc
      .moveTo(MARGIN, y + height)
      .lineTo(MARGIN + width, y + height)
      .lineWidth(0.6)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + height;
  });
}

function sectionTitle(doc: Doc, title: string, subtitle: string): void {
  ensureSpace(doc, 90);
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(title, MARGIN);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(subtitle, MARGIN);
  doc.moveDown(0.6);
}

function taskCell(entry: ReportEntryDto, extra: string[] = []): Line[] {
  const lines: Line[] = [{ text: `#${entry.task.taskNumber}  ${entry.task.name}`, bold: true }];
  const sub = [entry.task.project, ...extra].filter(Boolean).join(' · ');
  if (sub) {
    lines.push({ text: sub, muted: true, size: 8 });
  }
  return lines;
}

/**
 * The work report as a PDF (A4 landscape): a header with who and which period, the totals,
 * a table of the tasks worked on, and the daily work log grouped by day, oldest first.
 */
export function buildReportPdf(report: TaskReportDto, info: ReportWorkbookInfo): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: `Work report - ${info.userName}`,
      Author: info.userName,
      Creator: 'Daily Task Update',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const contentWidth = doc.page.width - MARGIN * 2;
  const periodLabel =
    report.from && report.to
      ? `${formatDate(report.from)} – ${formatDate(report.to)}`
      : report.from
        ? `From ${formatDate(report.from)}`
        : report.to
          ? `Up to ${formatDate(report.to)}`
          : 'All work to date';

  // ---------------------------------------------------------------- header
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Work report', MARGIN, MARGIN);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(
      `${info.userName}  ·  ${periodLabel}  ·  Generated ${formatDate(info.generatedAt.toISOString().slice(0, 10))}`,
    );
  doc.moveDown(1);

  // ---------------------------------------------------------------- totals
  const { totals } = report;
  const boxes: [string, string, string?][] = [
    ['Tasks worked on', String(totals.tasks)],
    [
      'Tasks completed',
      String(totals.completedTasks),
      totals.tasks > 0
        ? `${Math.round((totals.completedTasks / totals.tasks) * 100)}% of the tasks`
        : undefined,
    ],
    ['Daily entries', String(totals.entries)],
    ['Days worked', String(totals.daysWorked)],
    [
      'Hours recorded',
      formatMinutes(totals.minutesWorked),
      totals.entriesWithoutTime > 0
        ? `${plural(totals.entriesWithoutTime, 'entry', 'entries')} without times`
        : undefined,
    ],
  ];
  const gap = 10;
  const boxWidth = (contentWidth - gap * (boxes.length - 1)) / boxes.length;
  const boxTop = doc.y;
  boxes.forEach(([label, value, note], i) => {
    const x = MARGIN + i * (boxWidth + gap);
    doc.roundedRect(x, boxTop, boxWidth, 58, 6).lineWidth(0.8).strokeColor(BORDER).stroke();
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(label, x + 10, boxTop + 9);
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(INK)
      .text(value, x + 10, boxTop + 22);
    if (note) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(note, x + 10, boxTop + 43);
    }
  });
  doc.y = boxTop + 58;

  if (report.truncated) {
    doc.moveDown(0.8);
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#b42323')
      .text(
        `Only the first ${report.entries.length} entries are included; choose a shorter period for a complete report.`,
        MARGIN,
      );
  }

  if (report.entries.length === 0) {
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No work recorded in this period.');
  } else {
    // ---------------------------------------------------------------- tasks
    const byTask = new Map<
      string,
      { entry: ReportEntryDto; days: number; minutes: number; last: string }
    >();
    for (const entry of report.entries) {
      const row = byTask.get(entry.taskId);
      if (row) {
        row.days += 1;
        row.minutes += entry.minutesWorked ?? 0;
        row.last = entry.entryDate;
      } else {
        byTask.set(entry.taskId, {
          entry,
          days: 1,
          minutes: entry.minutesWorked ?? 0,
          last: entry.entryDate,
        });
      }
    }
    sectionTitle(doc, 'Tasks', 'Every task worked on in this period.');
    drawTable(
      doc,
      [
        { header: 'Task', width: 230 },
        { header: 'Assigned by', width: 115 },
        { header: 'Priority', width: 56 },
        { header: 'Due date', width: 76 },
        { header: 'Worked on', width: 142 },
        { header: 'Hours', width: 55 },
        { header: 'Status', width: contentWidth - 674 },
      ],
      [...byTask.values()]
        .sort((a, b) => a.entry.task.taskNumber - b.entry.task.taskNumber)
        .map(({ entry, days, minutes, last }) => ({
          cells: [
            taskCell(entry),
            [{ text: entry.task.assignedBy ?? '—', muted: !entry.task.assignedBy }],
            [
              {
                text: entry.task.priority ? (PRIORITY_LABEL[entry.task.priority] ?? '') : '—',
                muted: !entry.task.priority,
              },
            ],
            [
              {
                text: entry.task.dueDate ? formatDate(entry.task.dueDate) : '—',
                muted: !entry.task.dueDate,
              },
            ],
            [
              {
                text:
                  entry.entryDate === last
                    ? formatDate(last)
                    : `${formatDate(entry.entryDate)} – ${formatDate(last)}`,
              },
              { text: plural(days, 'day'), muted: true, size: 8 },
            ],
            [{ text: minutes > 0 ? formatMinutes(minutes) : '—', muted: minutes === 0 }],
            { status: entry.task.status as TaskStatus },
          ],
        })),
    );

    // ---------------------------------------------------------------- daily log
    sectionTitle(doc, 'Daily work log', 'What was done each day, oldest first.');
    const rows: ({ cells: Cell[] } | { band: string; meta: string })[] = [];
    let index = 0;
    while (index < report.entries.length) {
      const date = report.entries[index]!.entryDate;
      const day = report.entries.filter((entry) => entry.entryDate === date);
      const minutes = day.reduce((sum, entry) => sum + (entry.minutesWorked ?? 0), 0);
      rows.push({
        band: `${weekday(date)}, ${formatDate(date)}`,
        meta: `${plural(day.length, 'entry', 'entries')}${minutes > 0 ? ` · ${formatMinutes(minutes)}` : ''}`,
      });
      for (const entry of day) {
        const work: Line[] = [{ text: entry.description }];
        if (entry.remarks) {
          work.push({ text: `Remarks: ${entry.remarks}`, note: true });
        }
        if (entry.reference) {
          work.push({ text: `Ref: ${entry.reference}`, muted: true, size: 8 });
        }
        const time: Line[] = entry.startTime
          ? [
              {
                text: entry.endTime
                  ? `${formatClock(entry.startTime)} – ${formatClock(entry.endTime)}`
                  : `from ${formatClock(entry.startTime)}`,
              },
              ...(entry.minutesWorked !== null
                ? [{ text: formatMinutes(entry.minutesWorked), muted: true, size: 8 }]
                : []),
            ]
          : [{ text: '—', muted: true }];
        rows.push({
          cells: [
            taskCell(entry, [entry.task.assignedBy ? `Assigned by ${entry.task.assignedBy}` : '']),
            work,
            time,
            { status: entry.status as TaskStatus },
          ],
        });
      }
      index += day.length;
    }
    drawTable(
      doc,
      [
        { header: 'Task', width: 210 },
        { header: 'Work done', width: 340 },
        { header: 'Time', width: 120 },
        { header: 'Status', width: contentWidth - 670 },
      ],
      rows,
    );
  }

  // ---------------------------------------------------------------- page footers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    // The footer sits in the bottom margin: without this, writing there adds a page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 6;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(`Work report · ${info.userName} · ${periodLabel}`, MARGIN, y, {
      lineBreak: false,
    });
    const pageLabel = `Page ${i + 1} of ${range.count}`;
    doc.text(pageLabel, doc.page.width - MARGIN - doc.widthOfString(pageLabel), y, {
      lineBreak: false,
    });
  }

  doc.end();
  return done;
}
