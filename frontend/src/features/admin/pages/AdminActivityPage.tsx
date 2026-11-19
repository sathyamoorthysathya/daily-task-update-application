import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AdminDataSkeleton } from '../../../components/Skeletons';
import { adminApi } from '../admin.api';
import { DailyBars, HourStrip, RankedBars } from '../components/AdminCharts';
import {
  AdminHeader,
  Figure,
  LoadError,
  Pager,
  PeriodPicker,
  Segmented,
} from '../components/AdminUi';
import { formatDateTime, formatNumber, pageName, plural, timeAgo } from '../format';
import { useAdminData } from '../use-admin-data';

type Audience = 'all' | 'signed_in' | 'signed_out';

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'signed_in', label: 'Signed in' },
  { value: 'signed_out', label: 'Signed out' },
];

const DEVICE_NAMES: Record<string, string> = {
  desktop: 'Computer',
  mobile: 'Phone',
  tablet: 'Tablet',
};

/** Which pages users open, when, and on what devices; plus the visit log. */
export function AdminActivityPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? undefined;
  const [days, setDays] = useState(30);
  const [path, setPath] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [page, setPage] = useState(1);

  const summary = useAdminData(() => adminApi.activity(days), [days]);
  const visits = useAdminData(
    () => adminApi.visits({ days, page, path, userId, audience }),
    [days, page, path, userId, audience],
  );

  const data = summary.state.data;
  const log = visits.state.data;
  const filteredUser = userId ? log?.items.find((visit) => visit.user)?.user : undefined;

  return (
    <div className="app app--wide app--admin">
      <AdminHeader eyebrow="Admin panel" title="Page visits">
        <PeriodPicker
          value={days}
          onChange={(value) => {
            setDays(value);
            setPage(1);
          }}
        />
      </AdminHeader>
      <p className="muted admin-intro">
        Which pages of the app people open. Only the page is recorded (IDs and search words are
        removed), with the signed-in user, the device and the browser — never IP addresses.
      </p>

      {summary.state.status === 'error' && (
        <LoadError message={summary.state.message} onRetry={summary.reload} />
      )}

      {!data ? (
        summary.state.status === 'loading' && <AdminDataSkeleton />
      ) : (
        <div className="admin-stack" aria-busy={summary.state.status === 'loading'}>
          <section className="card admin-figures admin-figures--row" aria-label="Totals">
            <Figure label="Page views" value={data.totals.views} />
            <Figure label="Visitors (browsers)" value={data.totals.visitors} />
            <Figure label="Signed-in users" value={data.totals.signedInUsers} />
            <Figure label="Views while signed out" value={data.totals.signedOutViews} />
            <Figure label="Pages per visitor" value={data.totals.viewsPerVisitor.toFixed(1)} />
          </section>

          <div className="admin-grid">
            <section className="card admin-span-2" aria-labelledby="daily-heading">
              <h2 id="daily-heading">Page views per day</h2>
              <DailyBars
                days={data.daily}
                series={[{ key: 'views', label: 'Page views', tone: 'accent' }]}
                title="Page views per day"
              />
            </section>

            <section className="card admin-span-2" aria-labelledby="pages-heading">
              <h2 id="pages-heading">Pages</h2>
              {data.pages.length === 0 ? (
                <p className="muted">No page visits in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Page</th>
                        <th scope="col" className="admin-num">
                          Views
                        </th>
                        <th scope="col" className="admin-num">
                          Visitors
                        </th>
                        <th scope="col" className="admin-num">
                          Signed-in users
                        </th>
                        <th scope="col">Share of views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pages.map((row) => {
                        const share = data.totals.views ? row.views / data.totals.views : 0;
                        return (
                          <tr key={row.path}>
                            <td>
                              <button
                                type="button"
                                className="admin-link-button"
                                onClick={() => {
                                  setPath(row.path);
                                  setPage(1);
                                }}
                                title="Show the visits of this page"
                              >
                                <strong>{pageName(row.path)}</strong>
                              </button>
                              <span className="muted admin-path">{row.path}</span>
                            </td>
                            <td className="admin-num">{formatNumber(row.views)}</td>
                            <td className="admin-num">{formatNumber(row.visitors)}</td>
                            <td className="admin-num">{formatNumber(row.users)}</td>
                            <td>
                              <span className="admin-share">
                                <span className="ranked-bars-track" aria-hidden="true">
                                  <span
                                    className="ranked-bars-fill"
                                    style={{ width: `${share * 100}%` }}
                                  />
                                </span>
                                {Math.round(share * 100)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card" aria-labelledby="hours-heading">
              <h2 id="hours-heading">Time of day</h2>
              <HourStrip hours={data.hours} />
            </section>

            <section className="card" aria-labelledby="devices-heading">
              <h2 id="devices-heading">Devices</h2>
              <RankedBars
                unit="views"
                items={data.devices.map((row) => ({
                  key: row.name,
                  label: DEVICE_NAMES[row.name] ?? row.name,
                  value: row.views,
                }))}
              />
            </section>

            <section className="card" aria-labelledby="browsers-heading">
              <h2 id="browsers-heading">Browsers</h2>
              <RankedBars
                unit="views"
                items={data.browsers.map((row) => ({
                  key: row.name,
                  label: row.name,
                  value: row.views,
                }))}
              />
            </section>

            <section className="card" aria-labelledby="systems-heading">
              <h2 id="systems-heading">Operating systems</h2>
              <RankedBars
                unit="views"
                items={data.systems.map((row) => ({
                  key: row.name,
                  label: row.name,
                  value: row.views,
                }))}
              />
            </section>
          </div>
        </div>
      )}

      <section className="card admin-log" aria-labelledby="log-heading">
        <div className="card-header">
          <h2 id="log-heading">Visit log</h2>
          {log && <span className="muted">{plural(log.total, 'visit')}</span>}
        </div>
        <div className="admin-filters admin-filters--inline">
          <Segmented
            label="Who"
            options={AUDIENCES}
            value={audience}
            onChange={(value) => {
              setAudience(value);
              setPage(1);
            }}
          />
          {data && (
            <label className="admin-select">
              <span>Page</span>
              <select
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All pages</option>
                {data.pages.map((row) => (
                  <option key={row.path} value={row.path}>
                    {pageName(row.path)} ({row.path})
                  </option>
                ))}
              </select>
            </label>
          )}
          {userId && (
            <button
              type="button"
              className="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('userId');
                setParams(next, { replace: true });
                setPage(1);
              }}
            >
              Showing {filteredUser ? filteredUser.name : 'one user'} only · Show everyone
            </button>
          )}
        </div>

        {visits.state.status === 'error' && (
          <LoadError message={visits.state.message} onRetry={visits.reload} />
        )}
        {log &&
          (log.items.length === 0 ? (
            <p className="muted">No visits match.</p>
          ) : (
            <div className="table-wrap" aria-busy={visits.state.status === 'loading'}>
              <table className="data-table admin-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Page</th>
                    <th scope="col">User</th>
                    <th scope="col">Device</th>
                  </tr>
                </thead>
                <tbody>
                  {log.items.map((visit) => (
                    <tr key={visit.id}>
                      <td className="nowrap" title={formatDateTime(visit.createdAt)}>
                        {timeAgo(visit.createdAt)}
                      </td>
                      <td>
                        <strong>{pageName(visit.path)}</strong>
                        <span className="muted admin-path">{visit.path}</span>
                      </td>
                      <td>
                        {visit.user ? (
                          <Link to={`/admin/users/${visit.user.id}`} className="admin-user-cell">
                            <strong>{visit.user.name}</strong>
                            <span className="muted">{visit.user.email}</span>
                          </Link>
                        ) : (
                          <span className="muted">Signed out · visitor …{visit.visitor}</span>
                        )}
                      </td>
                      <td>
                        {visit.browser} on {visit.os}{' '}
                        <span className="muted">
                          ({DEVICE_NAMES[visit.deviceType] ?? visit.deviceType})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {log && (
          <Pager
            label="Visit log pages"
            page={log.page}
            pageSize={log.pageSize}
            total={log.total}
            onPage={setPage}
          />
        )}
      </section>
    </div>
  );
}
