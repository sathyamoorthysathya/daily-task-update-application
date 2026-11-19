import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SearchIcon } from '../../../components/icons';
import { AdminDataSkeleton } from '../../../components/Skeletons';
import { adminApi } from '../admin.api';
import type { UserSort, UserStatusFilter } from '../admin.types';
import { AdminHeader, LoadError, Pager, Pill, Segmented } from '../components/AdminUi';
import { formatDate, formatNumber, providerName, timeAgo } from '../format';
import { useAdminData } from '../use-admin-data';

const STATUS_OPTIONS: { value: UserStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'unverified', label: 'Email not verified' },
];

const SORT_OPTIONS: { value: UserSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'last_seen', label: 'Recently active' },
  { value: 'name', label: 'Name (A–Z)' },
];

const isStatus = (value: string | null): value is UserStatusFilter =>
  STATUS_OPTIONS.some((option) => option.value === value);
const isSort = (value: string | null): value is UserSort =>
  SORT_OPTIONS.some((option) => option.value === value);

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const statusParam = params.get('status');
  const sortParam = params.get('sort');
  const status: UserStatusFilter = isStatus(statusParam) ? statusParam : 'all';
  const sort: UserSort = isSort(sortParam) ? sortParam : 'newest';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [term, setTerm] = useState(search);

  const { state, reload } = useAdminData(
    () => adminApi.users({ search, status, sort, page }),
    [search, status, sort, page],
  );

  /** Changes filters in the URL (back/forward and shared links keep them); page 1 again. */
  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== 'all' && !(key === 'sort' && value === 'newest')) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    if (!('page' in changes)) {
      next.delete('page');
    }
    setParams(next, { replace: true });
  }

  // Search as you type (after a short pause).
  useEffect(() => {
    if (term.trim() === search) {
      return;
    }
    const timer = setTimeout(() => update({ search: term.trim() }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on typing only
  }, [term]);

  const data = state.data;

  return (
    <div className="app app--wide app--admin">
      <AdminHeader eyebrow="Admin panel" title="Users">
        {data && <span className="muted">{formatNumber(data.total)} matching</span>}
      </AdminHeader>

      <section className="card admin-filters" aria-label="Filters">
        <label className="admin-search">
          <SearchIcon />
          <span className="visually-hidden">Search users</span>
          <input
            type="search"
            placeholder="Search by name or email"
            value={term}
            maxLength={200}
            onChange={(event) => setTerm(event.target.value)}
          />
        </label>
        <Segmented
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => update({ status: value })}
        />
        <label className="admin-select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => update({ sort: event.target.value })}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {state.status === 'error' && <LoadError message={state.message} onRetry={reload} />}

      {!data ? (
        state.status === 'loading' && <AdminDataSkeleton table />
      ) : (
        <section className="card" aria-label="Users" aria-busy={state.status === 'loading'}>
          {data.items.length === 0 ? (
            <div className="empty-state">
              <h2>No users found</h2>
              <p className="muted">Try another search or filter.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table admin-table">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Sign-in</th>
                    <th scope="col">Status</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Last active</th>
                    <th scope="col" className="admin-num">
                      Workbooks
                    </th>
                    <th scope="col" className="admin-num">
                      Tasks
                    </th>
                    <th scope="col" className="admin-num">
                      Entries
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <Link to={`/admin/users/${user.id}`} className="admin-user-cell">
                          <strong>{user.name}</strong>
                          <span className="muted">{user.email}</span>
                        </Link>
                      </td>
                      <td>
                        <span className="admin-methods">
                          {user.hasPassword && <Pill tone="neutral">Password</Pill>}
                          {user.providers.map((provider) => (
                            <Pill key={provider} tone="info">
                              {providerName(provider)}
                            </Pill>
                          ))}
                        </span>
                      </td>
                      <td>
                        {user.disabled ? (
                          <Pill tone="bad">Disabled</Pill>
                        ) : user.emailVerified ? (
                          <Pill tone="good">Active</Pill>
                        ) : (
                          <Pill tone="warn">Not verified</Pill>
                        )}
                      </td>
                      <td className="nowrap">{formatDate(user.createdAt)}</td>
                      <td className="nowrap">{timeAgo(user.lastSeenAt)}</td>
                      <td className="admin-num">{formatNumber(user.workbooks)}</td>
                      <td className="admin-num">{formatNumber(user.tasks)}</td>
                      <td className="admin-num">{formatNumber(user.entries)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager
            label="Users pages"
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(next) => update({ page: String(next) })}
          />
        </section>
      )}
    </div>
  );
}
