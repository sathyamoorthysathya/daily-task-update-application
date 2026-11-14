import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormAlert } from '../../components/form/FormAlert';
import { DownloadIcon } from '../../components/icons';
import { errorMessage } from '../../lib/api/api-error';
import { useAuth } from '../auth/auth-context';
import { StatusBadge } from '../tasks/components/StatusBadge';
import { priorityLabel } from '../tasks/task-status';
import type { ReportEntry, Task, TaskReport } from '../tasks/task.types';
import { tasksApi } from '../tasks/tasks.api';
import {
  formatMinutes,
  formatTaskDate,
  formatWorkingHours,
  todayLocal,
} from '../tasks/tasks.schemas';

type Period = 'this-month' | 'last-month' | 'last-7-days' | 'overall' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-7-days', label: 'Last 7 days' },
  { value: 'overall', label: 'Overall' },
  { value: 'custom', label: 'Custom dates' },
];

const iso = (date: Date) => todayLocal(date);

/** The dates a period covers, in the user's time zone; no bounds for "overall". */
function periodRange(
  period: Period,
  custom: { from: string; to: string },
  now = new Date(),
): { from?: string; to?: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (period) {
    case 'this-month':
      return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month + 1, 0)) };
    case 'last-month':
      return { from: iso(new Date(year, month - 1, 1)), to: iso(new Date(year, month, 0)) };
    case 'last-7-days':
      return { from: iso(new Date(year, month, now.getDate() - 6)), to: iso(now) };
    case 'overall':
      return {};
    case 'custom':
      return { from: custom.from || undefined, to: custom.to || undefined };
  }
}

/** "Nov 1, 2026 – Nov 30, 2026", "From Nov 1, 2026", "All work to date" */
function rangeLabel(range: { from?: string; to?: string }): string {
  if (range.from && range.to) {
    return `${formatTaskDate(range.from)} – ${formatTaskDate(range.to)}`;
  }
  if (range.from) {
    return `From ${formatTaskDate(range.from)}`;
  }
  return range.to ? `Up to ${formatTaskDate(range.to)}` : 'All work to date';
}

const weekday = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    timeZone: 'UTC',
  });

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

interface DayGroup {
  date: string;
  entries: ReportEntry[];
  minutes: number;
}

function groupByDay(entries: ReportEntry[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const entry of entries) {
    let day = days.at(-1);
    if (!day || day.date !== entry.entryDate) {
      day = { date: entry.entryDate, entries: [], minutes: 0 };
      days.push(day);
    }
    day.entries.push(entry);
    day.minutes += entry.minutesWorked ?? 0;
  }
  return days;
}

interface TaskRow {
  task: Task;
  entries: number;
  minutes: number;
  firstDate: string;
  lastDate: string;
}

/** One row per task worked on in the period, in task-number order. */
function summariseTasks(entries: ReportEntry[]): TaskRow[] {
  const rows = new Map<string, TaskRow>();
  for (const entry of entries) {
    const row = rows.get(entry.taskId) ?? {
      task: entry.task,
      entries: 0,
      minutes: 0,
      firstDate: entry.entryDate,
      lastDate: entry.entryDate,
    };
    row.entries += 1;
    row.minutes += entry.minutesWorked ?? 0;
    row.lastDate = entry.entryDate;
    rows.set(entry.taskId, row);
  }
  return [...rows.values()].sort((a, b) => a.task.taskNumber - b.task.taskNumber);
}

type LoadResult = { key: string; data: TaskReport } | { key: string; error: string };

/**
 * Work report: everything the user recorded in a period (a month, a week, custom dates or
 * overall), with totals, a task summary and a day-by-day log. Made to be shown to a manager:
 * the page prints (or saves as PDF) without the app chrome.
 */
export function ReportPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const requested = params.get('period') as Period | null;
  const period: Period = PERIODS.some((option) => option.value === requested)
    ? (requested as Period)
    : 'this-month';
  const custom = { from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const range = periodRange(period, custom);
  const { from, to } = range;
  const dateError =
    from && to && from > to ? 'The end date must be on or after the start date.' : null;
  const requestKey = `${from ?? ''}|${to ?? ''}|${attempt}`;
  const loading = !dateError && result?.key !== requestKey;

  useEffect(() => {
    if (dateError) {
      return;
    }
    const controller = new AbortController();
    const key = `${from ?? ''}|${to ?? ''}|${attempt}`;
    tasksApi.report({ from, to }, controller.signal).then(
      (data) => setResult({ key, data }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key, error: errorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [from, to, attempt, dateError]);

  async function download(format: 'xlsx' | 'pdf') {
    setDownloading(format);
    setDownloadError(null);
    try {
      await tasksApi.downloadReport({ from, to }, format);
    } catch (err) {
      setDownloadError(`Could not download the report: ${errorMessage(err)}`);
    } finally {
      setDownloading(null);
    }
  }

  function change(changes: Record<string, string>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
        return next;
      },
      { replace: true },
    );
  }

  const report = result && 'data' in result ? result.data : null;
  const cannotDownload = !report || report.entries.length === 0 || loading || downloading !== null;
  const error = result && 'error' in result && result.key === requestKey ? result.error : null;
  const days = report ? groupByDay(report.entries) : [];
  const tasks = report ? summariseTasks(report.entries) : [];

  return (
    <div className="app app--report">
      <header className="app-header app-header--bar">
        <div>
          <h1>Work report</h1>
          <p className="muted no-print">
            Your tasks and daily work for a period, ready to show to your manager.
          </p>
          <p className="report-meta print-only">
            {user?.name} · {rangeLabel(range)} · Generated {formatTaskDate(todayLocal())}
          </p>
        </div>
        <div className="report-actions no-print" role="group" aria-label="Download report">
          <button
            type="button"
            className="button button--primary report-action"
            onClick={() => void download('pdf')}
            disabled={cannotDownload}
          >
            <DownloadIcon /> {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            className="button report-action"
            onClick={() => void download('xlsx')}
            disabled={cannotDownload}
          >
            <DownloadIcon /> {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </header>

      {downloadError && <FormAlert variant="error">{downloadError}</FormAlert>}

      <section className="card report-controls no-print" aria-label="Report period">
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented-option${option.value === period ? ' is-current' : ''}`}
              aria-pressed={option.value === period}
              onClick={() => change({ period: option.value === 'this-month' ? '' : option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="report-dates">
            <div className="field">
              <label htmlFor="report-from">From</label>
              <input
                id="report-from"
                type="date"
                value={custom.from}
                onChange={(event) => change({ from: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="report-to">To</label>
              <input
                id="report-to"
                type="date"
                value={custom.to}
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? 'report-date-error' : undefined}
                onChange={(event) => change({ to: event.target.value })}
              />
            </div>
          </div>
        )}
        {dateError ? (
          <p id="report-date-error" className="field-error report-period">
            {dateError}
          </p>
        ) : (
          <p className="muted report-period" role="status">
            {loading ? 'Loading…' : rangeLabel(range)}
          </p>
        )}
      </section>

      {error && (
        <FormAlert variant="error">
          {error}{' '}
          <button
            type="button"
            className="button button--subtle"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </FormAlert>
      )}

      {report && !error && !dateError && (
        <div className={loading ? 'report-body is-loading' : 'report-body'} aria-busy={loading}>
          {report.truncated && (
            <FormAlert variant="error">
              This period has more entries than one report can show. Only the first{' '}
              {report.entries.length} are included; choose a shorter period for a complete report.
            </FormAlert>
          )}

          <section className="report-totals" aria-label="Totals">
            <Total label="Tasks worked on" value={report.totals.tasks} />
            <Total
              label="Tasks completed"
              value={report.totals.completedTasks}
              note={
                report.totals.tasks > 0
                  ? `${Math.round((report.totals.completedTasks / report.totals.tasks) * 100)}% of the tasks`
                  : undefined
              }
            />
            <Total label="Daily entries" value={report.totals.entries} />
            <Total label="Days worked" value={report.totals.daysWorked} />
            <Total
              label="Hours recorded"
              value={formatMinutes(report.totals.minutesWorked)}
              note={
                report.totals.entriesWithoutTime > 0
                  ? `${plural(report.totals.entriesWithoutTime, 'entry', 'entries')} without times`
                  : undefined
              }
            />
          </section>

          {report.entries.length === 0 ? (
            <div className="card empty-state" role="status">
              <h2>No work recorded in this period</h2>
              <p className="muted">Choose another period, or add what you worked on.</p>
              <Link to="/tasks/new" className="button button--primary">
                Add a task
              </Link>
            </div>
          ) : (
            <>
              <section className="card" aria-labelledby="report-tasks-heading">
                <h2 id="report-tasks-heading">Tasks</h2>
                <p className="muted">Every task you worked on in this period.</p>
                <div className="table-wrap report-table-wrap">
                  <table
                    className="data-table report-table report-table--tasks"
                    aria-labelledby="report-tasks-heading"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Assigned by</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Due date</th>
                        <th scope="col">Worked on</th>
                        <th scope="col">Hours</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map(({ task, entries, minutes, firstDate, lastDate }) => (
                        <tr key={task.id}>
                          <td className="report-task">
                            <Link to={`/tasks/${task.id}`} className="report-task-name">
                              <span className="task-number">#{task.taskNumber}</span> {task.name}
                            </Link>
                            {task.project && <span className="report-sub">{task.project}</span>}
                          </td>
                          <td>{task.assignedBy ?? <span className="muted">—</span>}</td>
                          <td>
                            {task.priority ? (
                              <span className={`priority priority--${task.priority.toLowerCase()}`}>
                                {priorityLabel(task.priority)}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="nowrap">
                            {task.dueDate ? (
                              formatTaskDate(task.dueDate)
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="nowrap">
                            {firstDate === lastDate
                              ? formatTaskDate(firstDate)
                              : `${formatTaskDate(firstDate)} – ${formatTaskDate(lastDate)}`}
                            <span className="report-sub">{plural(entries, 'day')}</span>
                          </td>
                          <td className="nowrap">
                            {minutes > 0 ? (
                              formatMinutes(minutes)
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={task.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card" aria-labelledby="report-log-heading">
                <h2 id="report-log-heading">Daily work log</h2>
                <p className="muted">What you did each day, oldest first.</p>
                <div className="table-wrap report-table-wrap">
                  <table
                    className="data-table report-table report-table--log"
                    aria-labelledby="report-log-heading"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Work done</th>
                        <th scope="col">Time</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    {days.map((day) => (
                      <tbody key={day.date}>
                        <tr className="report-day">
                          <th scope="colgroup" colSpan={4}>
                            <span className="report-day-date">
                              {weekday(day.date)}, {formatTaskDate(day.date)}
                            </span>
                            <span className="report-day-meta">
                              {plural(day.entries.length, 'entry', 'entries')}
                              {day.minutes > 0 && ` · ${formatMinutes(day.minutes)}`}
                            </span>
                          </th>
                        </tr>
                        {day.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="report-task">
                              <Link to={`/tasks/${entry.taskId}`} className="report-task-name">
                                <span className="task-number">#{entry.task.taskNumber}</span>{' '}
                                {entry.task.name}
                              </Link>
                              {(entry.task.project || entry.task.assignedBy) && (
                                <span className="report-sub">
                                  {[
                                    entry.task.project,
                                    entry.task.assignedBy && `Assigned by ${entry.task.assignedBy}`,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                            </td>
                            <td className="report-work">
                              <span className="preserve-lines">{entry.description}</span>
                              {entry.remarks && (
                                <span className="report-remarks preserve-lines">
                                  <strong>Remarks:</strong> {entry.remarks}
                                </span>
                              )}
                              {entry.reference && (
                                <span className="report-sub">Ref: {entry.reference}</span>
                              )}
                            </td>
                            <td className="nowrap">
                              {entry.startTime ? (
                                <>
                                  {formatWorkingHours(entry.startTime, entry.endTime)}
                                  {entry.minutesWorked !== null && (
                                    <span className="report-sub">
                                      {formatMinutes(entry.minutesWorked)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              <StatusBadge status={entry.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Total({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <article className="report-total" aria-label={label}>
      <h2 className="report-total-label">{label}</h2>
      <p className="report-total-value">{value}</p>
      {note && <p className="report-total-note">{note}</p>}
    </article>
  );
}
