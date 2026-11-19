import { apiClient } from '../../lib/api/http-client';
import type {
  Activity,
  AdminAccount,
  AdminProfile,
  AdminSession,
  AdminUserDetail,
  AdminUserRow,
  Overview,
  Paged,
  SecurityEvent,
  SecuritySummary,
  Visit,
} from './admin.types';

/** The administrator's time zone: days and hours in the figures are counted in it. */
export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

type QueryValue = string | number | undefined | null;

/** "?a=1&b=x" from the defined values (empty strings and "all" are left out). */
function query(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const adminApi = {
  login: (body: { username: string; password: string; code?: string }) =>
    apiClient.post<{ admin: AdminProfile }>('/admin/auth/login', body),
  logout: () => apiClient.post<void>('/admin/auth/logout'),
  me: () => apiClient.get<AdminProfile>('/admin/auth/me'),
  sessions: () => apiClient.get<{ sessions: AdminSession[] }>('/admin/auth/sessions'),
  revokeOtherSessions: () =>
    apiClient.post<{ revoked: number }>('/admin/auth/sessions/revoke-others'),
  admins: () => apiClient.get<{ admins: AdminAccount[] }>('/admin/auth/admins'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiClient.post<void>('/admin/auth/change-password', body),
  startTwoFactor: (password: string) =>
    apiClient.post<{ secret: string; otpauthUri: string }>('/admin/auth/two-factor/setup', {
      password,
    }),
  enableTwoFactor: (code: string) =>
    apiClient.post<void>('/admin/auth/two-factor/enable', { code }),
  disableTwoFactor: (password: string, code: string) =>
    apiClient.post<void>('/admin/auth/two-factor/disable', { password, code }),

  overview: (days: number) =>
    apiClient.get<Overview>(`/admin/overview${query({ days, tz: browserTimeZone() })}`),
  activity: (days: number) =>
    apiClient.get<Activity>(`/admin/activity${query({ days, tz: browserTimeZone() })}`),
  visits: (params: {
    days: number;
    page: number;
    path?: string;
    userId?: string;
    audience?: string;
  }) => apiClient.get<Paged<Visit>>(`/admin/activity/visits${query({ ...params, pageSize: 25 })}`),

  users: (params: { search?: string; status?: string; sort?: string; page: number }) =>
    apiClient.get<Paged<AdminUserRow>>(`/admin/users${query({ ...params, pageSize: 20 })}`),
  user: (id: string) => apiClient.get<AdminUserDetail>(`/admin/users/${id}`),
  disableUser: (id: string, reason: string) =>
    apiClient.post<AdminUserDetail>(`/admin/users/${id}/disable`, { reason }),
  enableUser: (id: string) => apiClient.post<AdminUserDetail>(`/admin/users/${id}/enable`),
  signOutUser: (id: string) => apiClient.post<{ revoked: number }>(`/admin/users/${id}/sign-out`),

  security: (days: number) =>
    apiClient.get<SecuritySummary>(`/admin/security${query({ days, tz: browserTimeZone() })}`),
  securityEvents: (params: {
    days: number;
    category?: string;
    outcome?: string;
    search?: string;
    page: number;
  }) =>
    apiClient.get<Paged<SecurityEvent>>(
      `/admin/security/events${query({ ...params, pageSize: 25 })}`,
    ),
};
