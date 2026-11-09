import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { FormAlert } from '../../components/form/FormAlert';
import {
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  TasksIcon,
} from '../../components/icons';
import { errorMessage } from '../../lib/api/api-error';
import { apiClient } from '../../lib/api/http-client';
import { useAuth } from '../auth/auth-context';
import { SystemStatusPanel } from '../health/components/SystemStatusPanel';
import { StatusBadge } from '../tasks/components/StatusBadge';
import type { RecentTaskUpdate } from '../tasks/task.types';
import { formatTaskDate, todayLocal } from '../tasks/tasks.schemas';
import { useWorkbookList } from '../workbooks/use-workbook-list';
import type { Workbook } from '../workbooks/workbook.types';
import { ActivityChart, StatusDonut } from './components/charts';
import { StatCard } from './components/StatCard';
import { dashboardApi, type TaskSummary } from './dashboard.api';

type Load<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

const RECENT_LIMIT = 8;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "+25% vs last week", "Same as last week", ... */
function weekTrend(current: number, previous: number): { text: string; direction: string } {
  if (current === previous) {
    return { text: 'Same as the previous 7 days', direction: 'flat' };
  }
  if (previous === 0) {
    return { text: 'Up from none the previous 7 days', direction: 'up' };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return change > 0
    ? { text: `+${change}% vs the previous 7 days`, direction: 'up' }
    : { text: `${change}% vs the previous 7 days`, direction: 'down' };
}

const SYNC_LABEL: Record<Workbook['syncStatus'], string> = {
  synced: 'Excel up to date',
  pending: 'Updating Excel…',
  retrying: 'Excel update retrying',
  failed: 'Excel update failed',
};

export function DashboardPage() {
  const { user } = useAuth();
  const { state: workbooks, reload: reloadWorkbooks } = useWorkbookList();
  const created = (useLocation().state as { createdWorkbook?: string } | null)?.createdWorkbook;
  const [summary, setSummary] = useState<Load<TaskSummary>>({ status: 'loading' });
  const [recent, setRecent] = useState<RecentTaskUpdate[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    dashboardApi.summary(todayLocal()).then(
      (data) => active && setSummary({ status: 'ready', data }),
      (error: unknown) => active && setSummary({ status: 'error', message: errorMessage(error) }),
    );
    apiClient
      .get<{ updates: RecentTaskUpdate[] }>(`/tasks/recent-updates?limit=${RECENT_LIMIT}`)
      .then(
        (result) => active && setRecent(result.updates),
        () => active && setRecent([]),
      );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setSummary({ status: 'loading' });
    setAttempt((n) => n + 1);
    reloadWorkbooks();
  }, [reloadWorkbooks]);

  // First-time users start by creating their Excel workbook.
  if (workbooks.status === 'ready' && workbooks.data.workbooks.length === 0) {
    return <Navigate to="/workbooks/new" replace />;
  }
  if (!user) {
    return null;
  }

  const data = summary.status === 'ready' ? summary.data : null;
  const workbookList = workbooks.status === 'ready' ? workbooks.data.workbooks : [];
  const workbookName = (id: string) => workbookList.find((w) => w.id === id)?.name ?? '';
  const todayText = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="app app--dashboard">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Overview</p>
          <h1>Dashboard</h1>
        </div>
        <p className="page-date">
          <CalendarIcon />
          {todayText}
        </p>
      </header>

      {created && (
        <FormAlert variant="success">
          Your Excel workbook “{created}” is ready. You can download it from Workbooks at any time.
        </FormAlert>
      )}

      <section className="hero" aria-labelledby="welcome-heading">
        <div className="hero-text">
          <h2 id="welcome-heading">Welcome, {user.name}!</h2>
          <p>
            {data === null
              ? 'Record your daily work as tasks; every entry lands in your Excel workbook.'
              : data.totals.tasks === 0
                ? 'Add your first task to start tracking your work here and in Excel.'
                : `You have logged ${plural(data.periods.today, 'entry', 'entries')} today and ${plural(data.periods.last7Days, 'entry', 'entries')} in the last 7 days. ${plural(data.totals.open, 'task is', 'tasks are')} still open.`}
          </p>
          <div className="hero-actions">
            <Link to="/tasks/new" className="button hero-button-primary">
              <PlusIcon /> New task
            </Link>
            <Link to="/tasks" className="button hero-button">
              All tasks
            </Link>
          </div>
        </div>
        {data && (
          <div className="hero-ring" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <circle className="hero-ring-track" cx="60" cy="60" r="50" />
              <circle
                className="hero-ring-value"
                cx="60"
                cy="60"
                r="50"
                strokeDasharray={`${(data.totals.completionRate / 100) * 314.16} 314.16`}
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="60" textAnchor="middle">
                {data.totals.completionRate}%
              </text>
              <text x="60" y="78" textAnchor="middle" className="hero-ring-caption">
                completed
              </text>
            </svg>
          </div>
        )}
      </section>

      {summary.status === 'error' && (
        <FormAlert variant="error">
          Could not load your dashboard figures: {summary.message}{' '}
          <button type="button" className="button button--subtle" onClick={retry}>
            Try again
          </button>
        </FormAlert>
      )}

      <section
        className="stat-grid"
        aria-label="Key figures"
        aria-busy={summary.status === 'loading'}
      >
        {data ? (
          <>
            <StatCard
              label="Total tasks"
              tone="entries"
              icon={<TasksIcon />}
              value={data.totals.tasks}
              trend={data.activity.map((day) => day.entries)}
              footnote={`${plural(data.totals.entries, 'entry', 'entries')} in ${plural(data.totals.workbooks, 'workbook')}`}
            />
            <StatCard
              label="Entries this week"
              tone="week"
              icon={<CalendarIcon />}
              value={data.periods.last7Days}
              trend={data.activity.slice(-7).map((day) => day.entries)}
              footnote={(() => {
                const trend = weekTrend(data.periods.last7Days, data.periods.previous7Days);
                return <span className={`trend trend--${trend.direction}`}>{trend.text}</span>;
              })()}
            />
            <StatCard
              label="Completed"
              tone="completed"
              icon={<CheckCircleIcon />}
              value={data.totals.completed}
              trend={data.activity.map((day) => day.completed)}
              footnote={`${data.totals.completionRate}% of all tasks`}
            />
            <StatCard
              label="Open tasks"
              tone="open"
              icon={<ClockIcon />}
              value={data.totals.open}
              trend={data.activity.map((day) => day.entries - day.completed)}
              footnote={`${data.byStatus.IN_PROGRESS} in progress · ${data.byStatus.PENDING} pending · ${data.byStatus.ON_HOLD} on hold`}
            />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <div key={i} className="stat-card skeleton" />)
        )}
      </section>

      <div className="dash-grid">
        <div className="dash-column">
          <section className="card dash-activity" aria-labelledby="activity-heading">
            <div className="card-header">
              <div>
                <h2 id="activity-heading">Daily activity</h2>
                <p className="muted">Task entries per day over the last 14 days</p>
              </div>
            </div>
            {data ? (
              <ActivityChart days={data.activity} />
            ) : (
              <div className="skeleton skeleton--chart" />
            )}
          </section>

          <section className="card dash-recent" aria-labelledby="recent-heading">
            <div className="card-header">
              <h2 id="recent-heading">Recent task updates</h2>
              <Link to="/tasks">View all tasks</Link>
            </div>
            {recent === null && <div className="skeleton skeleton--table" />}
            {recent?.length === 0 && (
              <div className="dash-empty">
                <p className="muted">No task updates yet.</p>
                <Link to="/tasks/new" className="button button--primary">
                  Add your first task
                </Link>
              </div>
            )}
            {recent && recent.length > 0 && (
              <div className="table-wrap">
                <table className="data-table dash-table" aria-labelledby="recent-heading">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Task</th>
                      <th scope="col">Workbook</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((update) => (
                      <tr key={update.id}>
                        <td className="nowrap">{formatTaskDate(update.entryDate)}</td>
                        <td>
                          <Link to={`/tasks/${update.taskId}`} className="dash-task-link">
                            <span className="task-number">#{update.taskNumber}</span>{' '}
                            {update.taskName}
                          </Link>
                          <span className="dash-task-description muted">{update.description}</span>
                        </td>
                        <td className="muted">{workbookName(update.workbookId)}</td>
                        <td>
                          <StatusBadge status={update.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="dash-column">
          <section className="card dash-status" aria-labelledby="status-heading">
            <h2 id="status-heading">Tasks by status</h2>
            <p className="muted">Based on each task’s latest entry</p>
            {data ? (
              <StatusDonut counts={data.byStatus} />
            ) : (
              <div className="skeleton skeleton--donut" />
            )}
          </section>

          <section className="card dash-workbooks" aria-labelledby="workbooks-heading">
            <div className="card-header">
              <h2 id="workbooks-heading">Workbooks</h2>
              <Link to="/workbooks">Manage</Link>
            </div>
            {workbooks.status === 'error' && (
              <FormAlert variant="error">{workbooks.message}</FormAlert>
            )}
            {!data && workbooks.status !== 'error' && <div className="skeleton skeleton--list" />}
            {data && (
              <ul className="workbook-progress-list" data-testid="workbook-summary">
                {data.workbooks.map((progress) => {
                  const workbook = workbookList.find((w) => w.id === progress.id);
                  const percent =
                    progress.tasks === 0
                      ? 0
                      : Math.round((progress.completed / progress.tasks) * 100);
                  return (
                    <li key={progress.id} className="workbook-progress">
                      <div className="workbook-progress-head">
                        <span className="workbook-progress-name">
                          {progress.name}
                          {workbook?.isDefault && (
                            <span className="status-badge status-badge--up">Default</span>
                          )}
                        </span>
                        <span className="muted">
                          {progress.completed}/{progress.tasks} done
                        </span>
                      </div>
                      <div
                        className="progress"
                        role="progressbar"
                        aria-label={`${progress.name}: ${percent}% of tasks completed`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      {workbook && (
                        <span className={`sync-chip sync-chip--${workbook.syncStatus}`}>
                          {SYNC_LABEL[workbook.syncStatus]}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="dash-system">
            <SystemStatusPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
