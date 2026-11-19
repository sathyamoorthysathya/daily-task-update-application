/** Formatting shared by the admin pages. */

const numberFormat = new Intl.NumberFormat();

export const formatNumber = (value: number): string => numberFormat.format(value);

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${formatNumber(count)} ${count === 1 ? one : many}`;

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "just now", "5 minutes ago", "3 days ago", ... ("Never" for null). */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) {
    return 'Never';
  }
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Math.abs(seconds) < 45) {
    return 'just now';
  }
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return format.format(seconds, 'second');
}

/** Short day label of a YYYY-MM-DD date. */
export const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '');
  return letters.toUpperCase() || '?';
}

/** Friendly names of the app's pages (routes as recorded by the server). */
const PAGE_NAMES: Record<string, string> = {
  '/': 'Home',
  '/dashboard': 'Dashboard',
  '/tasks': 'Tasks',
  '/tasks/new': 'Add task',
  '/tasks/:id': 'Task details',
  '/report': 'Work report',
  '/workbooks': 'Workbooks',
  '/workbooks/new': 'Create workbook',
  '/profile': 'Profile',
  '/login': 'Sign in',
  '/register': 'Create account',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
};

export const pageName = (path: string): string => PAGE_NAMES[path] ?? 'Other page';

/** Plain-language names of audit events. */
const EVENT_NAMES: Record<string, string> = {
  'auth.register': 'Account created',
  'auth.login': 'Sign-in',
  'auth.google_login': 'Google sign-in',
  'auth.refresh_token_reuse': 'Stolen session token detected',
  'auth.session_expired': 'Session expired',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out of all devices',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'access.denied': 'Access denied',
  'profile.updated': 'Profile updated',
  'profile.avatar_changed': 'Profile picture changed',
  'workbook.created': 'Workbook created',
  'workbook.renamed': 'Workbook renamed',
  'workbook.deleted': 'Workbook deleted',
  'workbook.resync_requested': 'Excel update requested',
  'admin.created': 'Administrator created',
  'admin.login': 'Admin sign-in',
  'admin.logout': 'Admin signed out',
  'admin.locked': 'Admin account locked',
  'admin.ip_blocked': 'Admin access from a blocked address',
  'admin.password_changed': 'Admin password changed',
  'admin.two_factor_enabled': 'Admin turned on two-step verification',
  'admin.two_factor_disabled': 'Admin turned off two-step verification',
  'admin.user_disabled': 'User disabled by an admin',
  'admin.user_enabled': 'User enabled by an admin',
  'admin.user_signed_out': 'User signed out by an admin',
};

export const eventName = (event: string): string => EVENT_NAMES[event] ?? event;

/** Plain-language reasons of failed sign-ins. */
const REASONS: Record<string, string> = {
  wrong_password: 'Wrong password',
  unknown_email: 'Unknown email',
  unknown_username: 'Unknown admin username',
  no_password: 'Google-only account tried a password',
  account_disabled: 'Disabled account',
  wrong_code: 'Wrong two-step code',
  locked: 'Locked admin account',
  other: 'Other',
};

export const reasonName = (reason: string): string => REASONS[reason] ?? reason;

export const providerName = (provider: string): string =>
  provider === 'google' ? 'Google' : provider;
