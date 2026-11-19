import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextAreaField } from '../../../components/form/TextAreaField';
import { Modal } from '../../../components/Modal';
import { AdminDataSkeleton } from '../../../components/Skeletons';
import { errorMessage } from '../../../lib/api/api-error';
import { TASK_STATUSES } from '../../tasks/task-status';
import { adminApi } from '../admin.api';
import type { AdminUserDetail } from '../admin.types';
import { RankedBars } from '../components/AdminCharts';
import { AdminHeader, Figure, LoadError, Pill } from '../components/AdminUi';
import {
  eventName,
  formatDate,
  formatDateTime,
  pageName,
  plural,
  providerName,
  reasonName,
  timeAgo,
} from '../format';
import { useAdminData } from '../use-admin-data';

const reasonOf = (details: unknown): string | null => {
  const reason = (details as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reasonName(reason) : null;
};

export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const { state, reload, replace } = useAdminData(() => adminApi.user(userId), [userId]);
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const user = state.data;

  async function run(action: () => Promise<AdminUserDetail | void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await action();
      if (updated) {
        replace(updated);
      } else {
        reload();
      }
      setMessage({ tone: 'success', text: success });
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="app app--wide app--admin">
        <Link to="/admin/users" className="breadcrumb">
          ← All users
        </Link>
        {state.status === 'error' ? (
          <LoadError message={state.message} onRetry={reload} />
        ) : (
          <AdminDataSkeleton />
        )}
      </div>
    );
  }

  const profileRows: [string, string | null][] = [
    ['Phone', user.profile.phone],
    ['Company', user.profile.companyName],
    ['Job role', user.profile.jobRole],
    ['Industry', user.profile.industry],
    [
      'Experience',
      user.profile.yearsOfExperience === null
        ? null
        : plural(user.profile.yearsOfExperience, 'year'),
    ],
  ];

  return (
    <div className="app app--wide app--admin">
      <Link to="/admin/users" className="breadcrumb">
        ← All users
      </Link>
      <AdminHeader eyebrow="User" title={user.name}>
        <button
          type="button"
          className="button"
          disabled={busy || user.sessions.length === 0}
          onClick={() =>
            void run(async () => {
              await adminApi.signOutUser(user.id);
            }, `${user.name} was signed out of every device.`)
          }
        >
          Sign out everywhere
        </button>
        {user.disabled ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() =>
              void run(() => adminApi.enableUser(user.id), `${user.name} can sign in again.`)
            }
          >
            Enable account
          </button>
        ) : (
          <button
            type="button"
            className="button button--danger-solid"
            disabled={busy}
            onClick={() => setDialog(true)}
          >
            Disable account
          </button>
        )}
      </AdminHeader>

      <p className="admin-user-meta">
        <span>{user.email}</span>
        {user.disabled ? (
          <Pill tone="bad">Disabled</Pill>
        ) : user.emailVerified ? (
          <Pill tone="good">Active · email verified</Pill>
        ) : (
          <Pill tone="warn">Active · email not verified</Pill>
        )}
        <span className="muted">
          Joined {formatDate(user.createdAt)} · last active {timeAgo(user.lastSeenAt)}
        </span>
      </p>

      {message && <FormAlert variant={message.tone}>{message.text}</FormAlert>}
      {user.disabled && (
        <FormAlert variant="info">
          Disabled {formatDateTime(user.disabledAt)}
          {user.disabledReason ? ` — “${user.disabledReason}”` : ''}. This user cannot sign in.
        </FormAlert>
      )}

      <div className="admin-grid" aria-busy={state.status === 'loading'}>
        <section className="card" aria-labelledby="usage-heading">
          <h2 id="usage-heading">Usage</h2>
          <div className="admin-figures">
            <Figure label="Workbooks" value={user.workbooks} />
            <Figure label="Tasks" value={user.tasks} />
            <Figure label="Entries" value={user.entries} />
            <Figure label="Entries (30 days)" value={user.last30Days.entries} />
            <Figure label="Page views (30 days)" value={user.last30Days.views} />
            <Figure label="Last entry" value={timeAgo(user.lastEntryAt)} />
          </div>
          <h3 className="admin-subheading">Tasks by status</h3>
          <ul className="admin-status-list">
            {TASK_STATUSES.map((status) => (
              <li key={status.value}>
                <span
                  className={`legend-dot tone-${status.value.toLowerCase()}`}
                  aria-hidden="true"
                />
                {status.label}
                <strong>{user.tasksByStatus[status.value]}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="profile-heading">
          <h2 id="profile-heading">Profile</h2>
          <dl className="admin-dl">
            {profileRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? <span className="muted">Not given</span>}</dd>
              </div>
            ))}
            <div>
              <dt>Sign-in methods</dt>
              <dd className="admin-methods">
                {user.hasPassword && <Pill tone="neutral">Password</Pill>}
                {user.accounts.map((account) => (
                  <Pill key={account.provider} tone="info">
                    {providerName(account.provider)}
                    {account.email ? ` (${account.email})` : ''}
                  </Pill>
                ))}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card admin-span-2" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading">Signed-in devices</h2>
          {user.sessions.length === 0 ? (
            <p className="muted">Not signed in anywhere.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table admin-table">
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">IP address</th>
                    <th scope="col">Signed in</th>
                    <th scope="col">Last active</th>
                    <th scope="col">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {user.sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        {session.browser} on {session.os}{' '}
                        <span className="muted">({session.deviceType})</span>
                      </td>
                      <td>{session.ip ?? '—'}</td>
                      <td className="nowrap">{formatDateTime(session.startedAt)}</td>
                      <td className="nowrap">{timeAgo(session.lastActiveAt)}</td>
                      <td className="nowrap">{formatDate(session.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="top-pages-heading">
          <h2 id="top-pages-heading">Pages they use most (90 days)</h2>
          <RankedBars
            unit="views"
            empty="No page visits recorded."
            items={user.topPages.map((page) => ({
              key: page.path,
              label: pageName(page.path),
              note: page.path,
              value: page.views,
            }))}
          />
        </section>

        <section className="card" aria-labelledby="visits-heading">
          <div className="card-header">
            <h2 id="visits-heading">Recent page visits</h2>
            <Link to={`/admin/activity?userId=${user.id}`}>All visits</Link>
          </div>
          {user.recentVisits.length === 0 ? (
            <p className="muted">No page visits recorded.</p>
          ) : (
            <ul className="admin-list">
              {user.recentVisits.map((visit) => (
                <li key={visit.id}>
                  <span className="admin-list-main">
                    <strong>{pageName(visit.path)}</strong>
                    <span className="muted">
                      {visit.path} · {visit.browser} on {visit.os}
                    </span>
                  </span>
                  <span className="muted nowrap" title={formatDateTime(visit.createdAt)}>
                    {timeAgo(visit.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="workbooks-heading">
          <h2 id="workbooks-heading">Workbooks</h2>
          {user.workbookList.length === 0 ? (
            <p className="muted">No workbooks yet.</p>
          ) : (
            <ul className="admin-list">
              {user.workbookList.map((workbook) => (
                <li key={workbook.id}>
                  <span className="admin-list-main">
                    <strong>{workbook.name}</strong>
                    <span className="muted">Created {formatDate(workbook.createdAt)}</span>
                  </span>
                  <span className="muted nowrap">{plural(workbook.tasks, 'task')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="events-heading">
          <div className="card-header">
            <h2 id="events-heading">Security events</h2>
            <Link to={`/admin/security?search=${encodeURIComponent(user.email)}`}>
              Full audit log
            </Link>
          </div>
          {user.recentEvents.length === 0 ? (
            <p className="muted">No events recorded.</p>
          ) : (
            <ul className="admin-list">
              {user.recentEvents.map((event) => (
                <li key={event.id}>
                  <span className="admin-list-main">
                    <strong>
                      {eventName(event.event)}{' '}
                      {event.outcome === 'FAILURE' && <Pill tone="bad">Failed</Pill>}
                    </strong>
                    <span className="muted">
                      {[reasonOf(event.details), event.ip].filter(Boolean).join(' · ') || ' '}
                    </span>
                  </span>
                  <span className="muted nowrap" title={formatDateTime(event.createdAt)}>
                    {timeAgo(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {dialog && (
        <Modal
          labelledBy="disable-title"
          describedBy="disable-text"
          initialFocusRef={cancelRef}
          onClose={() => setDialog(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setDialog(false);
              void run(
                () => adminApi.disableUser(user.id, reason.trim()),
                `${user.name} was disabled and signed out of every device.`,
              );
              setReason('');
            }}
          >
            <h2 id="disable-title">Disable {user.name}?</h2>
            <p id="disable-text" className="muted">
              They are signed out of every device at once and cannot sign in until you enable the
              account again. Their workbooks and tasks are kept.
            </p>
            <TextAreaField
              label="Reason (optional, only administrators see it)"
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="dialog-actions">
              <button
                ref={cancelRef}
                type="button"
                className="button"
                onClick={() => setDialog(false)}
              >
                Cancel
              </button>
              <button type="submit" className="button button--danger-solid">
                Disable account
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
