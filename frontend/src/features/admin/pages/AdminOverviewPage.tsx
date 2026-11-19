import { useState } from 'react';
import { Link } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { ActivityIcon, CheckCircleIcon, TasksIcon, UsersIcon } from '../../../components/icons';
import { AdminDataSkeleton } from '../../../components/Skeletons';
import { StatCard } from '../../dashboard/components/StatCard';
import { useAdminAuth } from '../admin-auth-context';
import { adminApi } from '../admin.api';
import { DailyBars, RankedBars } from '../components/AdminCharts';
import { AdminHeader, Figure, LoadError, PeriodPicker } from '../components/AdminUi';
import { formatNumber, pageName, plural, timeAgo } from '../format';
import { useAdminData } from '../use-admin-data';

const DEVICE_NAMES: Record<string, string> = {
  desktop: 'Computer',
  mobile: 'Phone',
  tablet: 'Tablet',
};

export function AdminOverviewPage() {
  const { admin } = useAdminAuth();
  const [days, setDays] = useState(30);
  const { state, reload } = useAdminData(() => adminApi.overview(days), [days]);
  const data = state.data;

  const sum = (key: 'views' | 'visitors' | 'signups' | 'entries') =>
    data ? data.daily.reduce((total, day) => total + day[key], 0) : 0;

  return (
    <div className="app app--wide app--admin">
      <AdminHeader eyebrow="Admin panel" title="Overview">
        <PeriodPicker value={days} onChange={setDays} />
      </AdminHeader>

      {admin && !admin.twoFactorEnabled && (
        <FormAlert variant="info">
          Protect the admin panel: turn on{' '}
          <Link to="/admin/settings#two-step">two-step verification</Link> so a stolen password
          alone cannot open it.
        </FormAlert>
      )}
      {state.status === 'error' && <LoadError message={state.message} onRetry={reload} />}

      {!data ? (
        state.status === 'loading' && <AdminDataSkeleton />
      ) : (
        <div className="admin-stack" aria-busy={state.status === 'loading'}>
          <section className="stat-grid" aria-label="Key figures">
            <StatCard
              label="Users"
              tone="entries"
              icon={<UsersIcon />}
              value={formatNumber(data.users.total)}
              trend={data.daily.map((day) => day.signups)}
              footnote={`${plural(sum('signups'), 'new sign-up')} in ${days} days`}
            />
            <StatCard
              label="Active users"
              tone="week"
              icon={<CheckCircleIcon />}
              value={formatNumber(data.users.activeLast7Days)}
              trend={data.daily.map((day) => day.visitors)}
              footnote={`Last 7 days · ${formatNumber(data.users.activeLastDay)} today · ${formatNumber(data.users.activeLast30Days)} in 30 days`}
            />
            <StatCard
              label="Page views"
              tone="completed"
              icon={<ActivityIcon />}
              value={formatNumber(sum('views'))}
              trend={data.daily.map((day) => day.views)}
              footnote={`In ${days} days · ${plural(data.content.activeSessions, 'signed-in session')} now`}
            />
            <StatCard
              label="Task entries"
              tone="open"
              icon={<TasksIcon />}
              value={formatNumber(sum('entries'))}
              trend={data.daily.map((day) => day.entries)}
              footnote={`In ${days} days · ${plural(data.content.tasks, 'task')} in ${plural(data.content.workbooks, 'workbook')}`}
            />
          </section>

          <div className="admin-grid">
            <section className="card admin-span-2" aria-labelledby="visits-heading">
              <div className="card-header">
                <h2 id="visits-heading">Page views per day</h2>
                <Link to="/admin/activity">All page visits</Link>
              </div>
              <DailyBars
                days={data.daily}
                series={[{ key: 'views', label: 'Page views', tone: 'accent' }]}
                title="Page views per day"
              />
            </section>

            <section className="card" aria-labelledby="signups-heading">
              <h2 id="signups-heading">New sign-ups per day</h2>
              <DailyBars
                days={data.daily}
                series={[{ key: 'signups', label: 'Sign-ups', tone: 'accent' }]}
                title="New sign-ups per day"
              />
            </section>

            <section className="card" aria-labelledby="entries-heading">
              <h2 id="entries-heading">Task entries per day</h2>
              <DailyBars
                days={data.daily}
                series={[{ key: 'entries', label: 'Entries', tone: 'accent' }]}
                title="Task entries per day"
              />
            </section>

            <section className="card" aria-labelledby="pages-heading">
              <h2 id="pages-heading">Most visited pages</h2>
              <RankedBars
                unit="views"
                empty="No page visits in this period."
                items={data.topPages.map((page) => ({
                  key: page.path,
                  label: pageName(page.path),
                  note: `${page.path} · ${plural(page.visitors, 'visitor')}`,
                  value: page.views,
                }))}
              />
            </section>

            <section className="card" aria-labelledby="accounts-heading">
              <h2 id="accounts-heading">Accounts</h2>
              <div className="admin-figures">
                <Figure label="Active" value={data.users.active} />
                <Figure
                  label="Disabled"
                  value={data.users.disabled}
                  tone={data.users.disabled > 0 ? 'warn' : undefined}
                />
                <Figure
                  label="Email verified"
                  value={data.users.verified}
                  note={`of ${formatNumber(data.users.total)}`}
                />
                <Figure label="Sign in with Google" value={data.users.withGoogle} />
                <Figure label="Sign in with password" value={data.users.withPassword} />
                <Figure label="New in 7 days" value={data.users.newLast7Days} />
              </div>
              <h3 className="admin-subheading">Devices</h3>
              <RankedBars
                unit="views"
                empty="No page visits in this period."
                items={data.devices.map((device) => ({
                  key: device.name,
                  label: DEVICE_NAMES[device.name] ?? device.name,
                  value: device.views,
                }))}
              />
            </section>

            <section className="card" aria-labelledby="recent-users-heading">
              <div className="card-header">
                <h2 id="recent-users-heading">Newest users</h2>
                <Link to="/admin/users">All users</Link>
              </div>
              {data.recentUsers.length === 0 ? (
                <p className="muted">No users yet.</p>
              ) : (
                <ul className="admin-list">
                  {data.recentUsers.map((user) => (
                    <li key={user.id}>
                      <Link to={`/admin/users/${user.id}`} className="admin-list-main">
                        <strong>{user.name}</strong>
                        <span className="muted">{user.email}</span>
                      </Link>
                      <span className="muted nowrap">{timeAgo(user.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="top-users-heading">
              <h2 id="top-users-heading">Most active users ({days} days)</h2>
              {data.topUsers.length === 0 ? (
                <p className="muted">No activity in this period.</p>
              ) : (
                <ul className="admin-list">
                  {data.topUsers.map((user) => (
                    <li key={user.id}>
                      <Link to={`/admin/users/${user.id}`} className="admin-list-main">
                        <strong>{user.name}</strong>
                        <span className="muted">{user.email}</span>
                      </Link>
                      <span className="muted nowrap">
                        {plural(user.entries, 'entry', 'entries')} · {plural(user.views, 'view')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="security-heading">
              <div className="card-header">
                <h2 id="security-heading">Security</h2>
                <Link to="/admin/security">Security details</Link>
              </div>
              <div className="admin-figures">
                <Figure
                  label="Failed sign-ins (24 h)"
                  value={data.security.failedSignInsLastDay}
                  tone={data.security.failedSignInsLastDay >= 10 ? 'bad' : undefined}
                />
                <Figure
                  label="Failed admin sign-ins (24 h)"
                  value={data.security.failedAdminSignInsLastDay}
                  tone={data.security.failedAdminSignInsLastDay > 0 ? 'warn' : undefined}
                />
                <Figure
                  label="Locked admin accounts"
                  value={data.security.lockedAdmins}
                  tone={data.security.lockedAdmins > 0 ? 'bad' : undefined}
                />
                <Figure
                  label="Stolen-token alerts (7 days)"
                  value={data.security.tokenReuseLast7Days}
                  tone={data.security.tokenReuseLast7Days > 0 ? 'bad' : undefined}
                />
              </div>
            </section>
          </div>
          <p className="muted admin-footnote">
            Days are counted in your time zone ({data.period.timeZone}).
          </p>
        </div>
      )}
    </div>
  );
}
