import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { errorMessage } from '../../../lib/api/api-error';
import { useWorkbookList } from '../../workbooks/use-workbook-list';
import { StatusBadge } from '../components/StatusBadge';
import { TASK_STATUSES } from '../task-status';
import type { TaskListQuery, TaskPage, TaskSort, TaskStatus } from '../task.types';
import { tasksApi } from '../tasks.api';
import { formatTaskDate } from '../tasks.schemas';

const PAGE_SIZES = [10, 20, 50];
const SORTS: { value: TaskSort; label: string }[] = [
  { value: 'latest', label: 'Latest date first' },
  { value: 'oldest', label: 'Oldest date first' },
  { value: 'number', label: 'Task number' },
  { value: 'name', label: 'Name (A–Z)' },
];
const FILTER_KEYS = ['search', 'status', 'workbookId', 'from', 'to'] as const;

interface Filters {
  search: string;
  status: string;
  workbookId: string;
  from: string;
  to: string;
  sort: TaskSort;
  page: number;
  pageSize: number;
}

function readFilters(params: URLSearchParams): Filters {
  const positive = (value: string | null, fallback: number) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  };
  const sort = params.get('sort') as TaskSort | null;
  const pageSize = positive(params.get('pageSize'), 20);
  return {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    workbookId: params.get('workbookId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    sort: SORTS.some((option) => option.value === sort) ? (sort as TaskSort) : 'latest',
    page: positive(params.get('page'), 1),
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 20,
  };
}

/** Page numbers around the current page, e.g. 1 … 4 5 [6] 7 8 … 12. */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const pages = new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((p, index) => {
    if (index > 0 && p - (sorted[index - 1] ?? p) > 1) {
      result.push('gap');
    }
    result.push(p);
  });
  return result;
}

function toListQuery(filters: Filters): TaskListQuery {
  return {
    search: filters.search || undefined,
    status: (filters.status || undefined) as TaskStatus | undefined,
    workbookId: filters.workbookId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

type LoadResult = { key: string; data: TaskPage } | { key: string; error: string };

/** All tasks of the signed-in user, with search, filters, sorting and pagination. */
export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const flash = (useLocation().state as { message?: string } | null)?.message;
  const filters = readFilters(params);
  const { state: workbookState } = useWorkbookList();
  const [searchText, setSearchText] = useState(filters.search);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  const dateError =
    filters.from && filters.to && filters.from > filters.to
      ? 'The end date must be on or after the start date.'
      : null;
  const paramsString = params.toString();
  const requestKey = `${paramsString}#${attempt}`;
  const loading = !dateError && result?.key !== requestKey;
  const filtersActive = FILTER_KEYS.some((key) => filters[key] !== '');

  /** Changes URL parameters; any filter change returns to page 1. */
  function update(changes: Partial<Record<keyof Filters, string>>, keepPage = false) {
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
        if (!keepPage) {
          next.delete('page');
        }
        return next;
      },
      { replace: !keepPage },
    );
  }

  // Search as the user types, without a request per keystroke.
  useEffect(() => {
    const value = searchText.trim();
    if (value === (params.get('search') ?? '')) {
      return;
    }
    const timer = setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value) {
            next.set('search', value);
          } else {
            next.delete('search');
          }
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, params, setParams]);

  useEffect(() => {
    if (dateError) {
      return;
    }
    const controller = new AbortController();
    const key = `${paramsString}#${attempt}`;
    tasksApi
      .list(toListQuery(readFilters(new URLSearchParams(paramsString))), controller.signal)
      .then(
        (data) => setResult({ key, data }),
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setResult({ key, error: errorMessage(error) });
          }
        },
      );
    return () => controller.abort();
  }, [paramsString, attempt, dateError]);

  function clearFilters() {
    setSearchText('');
    setParams(
      (previous) => {
        const next = new URLSearchParams();
        for (const key of ['sort', 'pageSize']) {
          const value = previous.get(key);
          if (value) {
            next.set(key, value);
          }
        }
        return next;
      },
      { replace: true },
    );
  }

  const data = result && 'data' in result ? result.data : null;
  const error = result && 'error' in result && result.key === requestKey ? result.error : null;
  const workbooks = workbookState.status === 'ready' ? workbookState.data.workbooks : [];

  return (
    <div className="app app--wide">
      <header className="app-header app-header--bar">
        <div>
          <h1>Tasks</h1>
          <p className="muted">
            All your tasks across workbooks. Select a task to see its details.
          </p>
        </div>
        <Link to="/tasks/new" className="button button--primary">
          New task
        </Link>
      </header>

      {flash && <FormAlert variant="success">{flash}</FormAlert>}

      <section className="card task-filters" role="search" aria-label="Filter tasks">
        <div className="field field--search">
          <label htmlFor="task-search">Search</label>
          <input
            id="task-search"
            type="search"
            placeholder="Task name or #number"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="task-status">Status</label>
          <select
            id="task-status"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">All statuses</option>
            {TASK_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-workbook-filter">Workbook</label>
          <select
            id="task-workbook-filter"
            value={filters.workbookId}
            onChange={(event) => update({ workbookId: event.target.value })}
          >
            <option value="">All workbooks</option>
            {workbooks.map((workbook) => (
              <option key={workbook.id} value={workbook.id}>
                {workbook.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-from">From</label>
          <input
            id="task-from"
            type="date"
            value={filters.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="task-to">To</label>
          <input
            id="task-to"
            type="date"
            value={filters.to}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? 'task-date-error' : undefined}
            onChange={(event) => update({ to: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="task-sort">Sort by</label>
          <select
            id="task-sort"
            value={filters.sort}
            onChange={(event) =>
              update({ sort: event.target.value === 'latest' ? '' : event.target.value })
            }
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </div>
        {dateError && (
          <p id="task-date-error" className="field-error task-filters-message">
            {dateError}
          </p>
        )}
        {filtersActive && (
          <div className="task-filters-message">
            <button type="button" className="button button--subtle" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      <section className="card task-results" aria-label="Task list" aria-busy={loading}>
        {error ? (
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
        ) : !data ? (
          <p className="muted" role="status">
            Loading tasks…
          </p>
        ) : data.total === 0 ? (
          <div className="empty-state" role="status">
            {filtersActive ? (
              <>
                <h2>No tasks match your filters</h2>
                <p className="muted">Try a different search, status, workbook or date range.</p>
                <button type="button" className="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h2>No tasks yet</h2>
                <p className="muted">Tasks you record will be listed here.</p>
                <Link to="/tasks/new" className="button button--primary">
                  Create your first task
                </Link>
              </>
            )}
          </div>
        ) : data.items.length === 0 ? (
          <div className="empty-state" role="status">
            <h2>This page is empty</h2>
            <p className="muted">There are only {data.totalPages} pages of results.</p>
            <button
              type="button"
              className="button"
              onClick={() => update({ page: String(data.totalPages) }, true)}
            >
              Go to the last page
            </button>
          </div>
        ) : (
          <>
            <p className="muted results-summary" role="status">
              {loading
                ? 'Updating…'
                : `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total} ${data.total === 1 ? 'task' : 'tasks'}`}
            </p>
            <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
              <table className="data-table task-table">
                <thead>
                  <tr>
                    <th scope="col">Task #</th>
                    <th scope="col">Task</th>
                    <th scope="col">Workbook</th>
                    <th scope="col">Latest date</th>
                    <th scope="col">Entries</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((task) => (
                    <tr
                      key={task.id}
                      className="clickable-row"
                      onClick={() => void navigate(`/tasks/${task.id}`)}
                    >
                      <td className="task-number">#{task.taskNumber}</td>
                      <td>
                        <Link
                          to={`/tasks/${task.id}`}
                          className="recent-name"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {task.name}
                        </Link>
                        <span className="recent-description muted">{task.latestDescription}</span>
                      </td>
                      <td>{task.workbook.name}</td>
                      <td className="nowrap">{formatTaskDate(task.lastEntryDate)}</td>
                      <td>{task.entryCount}</td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav className="pagination" aria-label="Pagination">
              <div className="field field--inline">
                <label htmlFor="task-page-size">Per page</label>
                <select
                  id="task-page-size"
                  value={data.pageSize}
                  onChange={(event) => update({ pageSize: event.target.value })}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pagination-pages">
                <button
                  type="button"
                  className="button"
                  disabled={data.page <= 1 || loading}
                  onClick={() => update({ page: String(data.page - 1) }, true)}
                >
                  Previous
                </button>
                {pageWindow(data.page, data.totalPages).map((page, index) =>
                  page === 'gap' ? (
                    <span key={`gap-${index}`} className="pagination-gap" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={page}
                      type="button"
                      className={`button pagination-page${page === data.page ? ' is-current' : ''}`}
                      aria-current={page === data.page ? 'page' : undefined}
                      aria-label={`Page ${page}`}
                      disabled={loading}
                      onClick={() => update({ page: String(page) }, true)}
                    >
                      {page}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="button"
                  disabled={data.page >= data.totalPages || loading}
                  onClick={() => update({ page: String(data.page + 1) }, true)}
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
