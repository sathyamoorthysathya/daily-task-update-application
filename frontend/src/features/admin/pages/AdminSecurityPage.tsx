import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SearchIcon } from '../../../components/icons';
import { AdminDataSkeleton } from '../../../components/Skeletons';
import { adminApi } from '../admin.api';
import type { SecurityCategory, SecurityEvent } from '../admin.types';
import { DailyBars, RankedBars } from '../components/AdminCharts';
import {
  AdminHeader,
  Figure,
  LoadError,
  Pager,
  PeriodPicker,
  Pill,
  Segmented,
} from '../components/AdminUi';
import { eventName, formatDateTime, plural, reasonName, timeAgo } from '../format';
import { useAdminData } from '../use-admin-data';

const CATEGORIES: { value: SecurityCategory; label: string }[] = [
  { value: 'all', label: 'All events' },
  { value: 'sign_in', label: 'Sign-ins' },
  { value: 'account', label: 'Account changes' },
  { value: 'admin', label: 'Admin actions' },
  { value: 'access', label: 'Access denied' },
];

type Outcome = 'all' | 'SUCCESS' | 'FAILURE';

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'all', label: 'Any result' },
  { value: 'FAILURE', label: 'Failed' },
  { value: 'SUCCESS', label: 'Succeeded' },
];

/** Who the event is about: the user, the admin, or the email typed. */
function actor(event: SecurityEvent) {
  if (event.user) {
    return (
      <Link to={`/admin/users/${event.user.id}`} className="admin-user-cell">
        <strong>{event.user.name}</strong>
        <span className="muted">{event.user.email}</span>
      </Link>
    );
  }
  if (event.admin) {
    return (
      <span className="admin-user-cell">
        <strong>@{event.admin.username}</strong>
        <span className="muted">Administrator</span>
      </span>
    );
  }
  const username = (event.details as { username?: unknown } | null)?.username;
  if (event.email || typeof username === 'string') {
    return (
      <span className="admin-user-cell">
        <strong>{event.email ?? `@${String(username)}`}</strong>
        <span className="muted">No such account</span>
      </span>
    );
  }
  return <span className="muted">—</span>;
}

/** Short readable summary of an event's details (reason, counts). */
function detailText(details: unknown): string {
  if (!details || typeof details !== 'object') {
    return '';
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (value === null || value === undefined || key === 'username') {
      continue;
    }
    if (key === 'reason' && typeof value === 'string') {
      parts.push(reasonName(value));
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    ) {
      parts.push(`${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(value)}`);
    }
  }
  return parts.join(' · ');
}

export function AdminSecurityPage() {
  const [params] = useSearchParams();
  const [days, setDays] = useState(7);
  const [category, setCategory] = useState<SecurityCategory>('all');
  const [outcome, setOutcome] = useState<Outcome>('all');
  const [term, setTerm] = useState(params.get('search') ?? '');
  const [search, setSearch] = useState(term);
  const [page, setPage] = useState(1);

  const summary = useAdminData(() => adminApi.security(days), [days]);
  const events = useAdminData(
    () => adminApi.securityEvents({ days, category, outcome, search, page }),
    [days, category, outcome, search, page],
  );

  useEffect(() => {
    if (term.trim() === search) {
      return;
    }
    const timer = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [term, search]);

  const data = summary.state.data;
  const log = events.state.data;

  return (
    <div className="app app--wide app--admin">
      <AdminHeader eyebrow="Admin panel" title="Security">
        <PeriodPicker
          value={days}
          onChange={(value) => {
            setDays(value);
            setPage(1);
          }}
        />
      </AdminHeader>

      {summary.state.status === 'error' && (
        <LoadError message={summary.state.message} onRetry={summary.reload} />
      )}

      {!data ? (
        summary.state.status === 'loading' && <AdminDataSkeleton />
      ) : (
        <div className="admin-stack" aria-busy={summary.state.status === 'loading'}>
          <section className="card admin-figures admin-figures--row" aria-label="Totals">
            <Figure label="Sign-ins" value={data.totals.signIns} />
            <Figure
              label="Failed sign-ins"
              value={data.totals.failedSignIns}
              tone={data.totals.failedSignIns > data.totals.signIns ? 'bad' : undefined}
            />
            <Figure
              label="Failed admin sign-ins"
              value={data.totals.failedAdminSignIns}
              tone={data.totals.failedAdminSignIns > 0 ? 'warn' : undefined}
            />
            <Figure
              label="Admin lockouts"
              value={data.totals.adminLockouts}
              note={
                data.totals.lockedAdmins > 0 ? `${data.totals.lockedAdmins} locked now` : undefined
              }
              tone={data.totals.lockedAdmins > 0 ? 'bad' : undefined}
            />
            <Figure
              label="Stolen-token alerts"
              value={data.totals.tokenReuse}
              note="Sessions ended automatically"
              tone={data.totals.tokenReuse > 0 ? 'bad' : undefined}
            />
            <Figure label="Access denied" value={data.totals.accessDenied} />
            <Figure label="Password reset requests" value={data.totals.passwordResets} />
            <Figure label="Disabled users" value={data.totals.disabledUsers} />
          </section>

          <div className="admin-grid">
            <section className="card admin-span-2" aria-labelledby="signins-heading">
              <h2 id="signins-heading">Sign-ins per day (users and administrators)</h2>
              <DailyBars
                days={data.daily}
                series={[
                  { key: 'succeeded', label: 'Succeeded', tone: 'accent' },
                  { key: 'failed', label: 'Failed', tone: 'danger' },
                ]}
                title="Sign-ins per day"
              />
            </section>

            <section className="card" aria-labelledby="reasons-heading">
              <h2 id="reasons-heading">Why sign-ins failed</h2>
              <RankedBars
                unit="failures"
                empty="No failed sign-ins in this period."
                items={data.failureReasons.map((row) => ({
                  key: row.reason,
                  label: reasonName(row.reason),
                  value: row.count,
                }))}
              />
            </section>

            <section className="card" aria-labelledby="ips-heading">
              <h2 id="ips-heading">Addresses with the most failures</h2>
              <p className="muted admin-card-note">
                Many failures from one address, or for many accounts, usually means password
                guessing. Sign-in attempts are rate-limited automatically.
              </p>
              {data.topFailedIps.length === 0 ? (
                <p className="muted">None in this period.</p>
              ) : (
                <ul className="admin-list">
                  {data.topFailedIps.map((row) => (
                    <li key={row.ip}>
                      <button
                        type="button"
                        className="admin-link-button admin-list-main"
                        onClick={() => {
                          setTerm(row.ip);
                          setOutcome('FAILURE');
                        }}
                      >
                        <strong>{row.ip}</strong>
                        <span className="muted">
                          {plural(row.accounts, 'account')} tried · last {timeAgo(row.lastAt)}
                        </span>
                      </button>
                      <Pill tone={row.failures >= 10 ? 'bad' : 'warn'}>
                        {plural(row.failures, 'failure')}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="targets-heading">
              <h2 id="targets-heading">Accounts with the most failures</h2>
              {data.targetedAccounts.length === 0 ? (
                <p className="muted">None in this period.</p>
              ) : (
                <ul className="admin-list">
                  {data.targetedAccounts.map((row) => (
                    <li key={row.account}>
                      <button
                        type="button"
                        className="admin-link-button admin-list-main"
                        onClick={() => {
                          setTerm(row.account.replace(/^admin:/, ''));
                          setOutcome('FAILURE');
                        }}
                      >
                        <strong>
                          {row.account.startsWith('admin:')
                            ? `@${row.account.slice(6)} (admin)`
                            : row.account}
                        </strong>
                        <span className="muted">last {timeAgo(row.lastAt)}</span>
                      </button>
                      <Pill tone={row.failures >= 5 ? 'bad' : 'warn'}>
                        {plural(row.failures, 'failure')}
                      </Pill>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      <section className="card admin-log" aria-labelledby="audit-heading">
        <div className="card-header">
          <h2 id="audit-heading">Audit log</h2>
          {log && <span className="muted">{plural(log.total, 'event')}</span>}
        </div>
        <div className="admin-filters admin-filters--inline">
          <label className="admin-search">
            <SearchIcon />
            <span className="visually-hidden">Search the audit log</span>
            <input
              type="search"
              placeholder="Email, name, IP address or event"
              value={term}
              maxLength={200}
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          <Segmented
            label="Category"
            options={CATEGORIES}
            value={category}
            onChange={(value) => {
              setCategory(value);
              setPage(1);
            }}
          />
          <Segmented
            label="Result"
            options={OUTCOMES}
            value={outcome}
            onChange={(value) => {
              setOutcome(value);
              setPage(1);
            }}
          />
        </div>

        {events.state.status === 'error' && (
          <LoadError message={events.state.message} onRetry={events.reload} />
        )}
        {log &&
          (log.items.length === 0 ? (
            <p className="muted">No events match.</p>
          ) : (
            <div className="table-wrap" aria-busy={events.state.status === 'loading'}>
              <table className="data-table admin-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Who</th>
                    <th scope="col">From</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {log.items.map((event) => (
                    <tr key={event.id}>
                      <td className="nowrap" title={formatDateTime(event.createdAt)}>
                        {formatDateTime(event.createdAt)}
                      </td>
                      <td>
                        <span className="admin-event">
                          {eventName(event.event)}
                          {event.outcome === 'FAILURE' ? (
                            <Pill tone="bad">Failed</Pill>
                          ) : (
                            <Pill tone="good">OK</Pill>
                          )}
                        </span>
                        <span className="muted admin-path">{event.event}</span>
                      </td>
                      <td>{actor(event)}</td>
                      <td>
                        {event.ip ?? '—'}
                        {event.browser && (
                          <span className="muted admin-path">
                            {event.browser} on {event.os}
                          </span>
                        )}
                      </td>
                      <td className="admin-details">{detailText(event.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {log && (
          <Pager
            label="Audit log pages"
            page={log.page}
            pageSize={log.pageSize}
            total={log.total}
            onPage={setPage}
          />
        )}
      </section>
      {!log && events.state.status === 'loading' && <AdminDataSkeleton table />}
    </div>
  );
}
