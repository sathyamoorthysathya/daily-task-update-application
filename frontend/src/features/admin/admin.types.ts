import type { TaskStatus } from '../tasks/task.types';

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string;
  twoFactorEnabled: boolean;
  passwordChangedAt: string;
  createdAt: string;
  previousSignIn: { at: string; ip: string | null; browser: string; os: string } | null;
  session: { expiresAt: string; idleTimeoutMinutes: number };
}

export interface AdminSession {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  browser: string;
  os: string;
}

export interface AdminAccount {
  username: string;
  displayName: string;
  twoFactorEnabled: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NamedCount {
  name: string;
  views: number;
}

export interface PageStat {
  path: string;
  views: number;
  visitors: number;
  users: number;
}

export interface Overview {
  period: { days: number; timeZone: string };
  users: {
    total: number;
    active: number;
    disabled: number;
    verified: number;
    withGoogle: number;
    withPassword: number;
    newLast7Days: number;
    newLast30Days: number;
    activeLastDay: number;
    activeLast7Days: number;
    activeLast30Days: number;
  };
  content: { workbooks: number; tasks: number; entries: number; activeSessions: number };
  daily: { date: string; signups: number; views: number; visitors: number; entries: number }[];
  topPages: PageStat[];
  devices: NamedCount[];
  recentUsers: { id: string; name: string; email: string; createdAt: string }[];
  topUsers: { id: string; name: string; email: string; entries: number; views: number }[];
  security: {
    failedSignInsLastDay: number;
    failedAdminSignInsLastDay: number;
    lockedAdmins: number;
    tokenReuseLast7Days: number;
  };
}

export interface Activity {
  period: { days: number; timeZone: string };
  totals: {
    views: number;
    visitors: number;
    signedInUsers: number;
    signedOutViews: number;
    viewsPerVisitor: number;
  };
  daily: { date: string; views: number; visitors: number; users: number }[];
  pages: PageStat[];
  devices: NamedCount[];
  browsers: NamedCount[];
  systems: NamedCount[];
  hours: number[];
}

export interface Visit {
  id: string;
  path: string;
  createdAt: string;
  deviceType: string;
  browser: string;
  os: string;
  visitor: string;
  user: { id: string; name: string; email: string } | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  providers: string[];
  hasPassword: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  workbooks: number;
  tasks: number;
  entries: number;
}

export interface AdminUserDetail extends AdminUserRow {
  disabledAt: string | null;
  disabledReason: string | null;
  profile: {
    phone: string | null;
    companyName: string | null;
    jobRole: string | null;
    industry: string | null;
    yearsOfExperience: number | null;
  };
  accounts: { provider: string; email: string | null; linkedAt: string; lastLoginAt: string }[];
  tasksByStatus: Record<TaskStatus, number>;
  lastEntryAt: string | null;
  last30Days: { entries: number; views: number };
  workbookList: { id: string; name: string; tasks: number; createdAt: string }[];
  sessions: {
    id: string;
    startedAt: string;
    lastActiveAt: string;
    expiresAt: string;
    ip: string | null;
    browser: string;
    os: string;
    deviceType: string;
  }[];
  topPages: { path: string; views: number }[];
  recentVisits: { id: string; path: string; createdAt: string; browser: string; os: string }[];
  recentEvents: {
    id: string;
    event: string;
    outcome: 'SUCCESS' | 'FAILURE';
    createdAt: string;
    ip: string | null;
    details: unknown;
  }[];
}

export interface SecuritySummary {
  period: { days: number; timeZone: string };
  totals: {
    signIns: number;
    failedSignIns: number;
    adminSignIns: number;
    failedAdminSignIns: number;
    adminLockouts: number;
    tokenReuse: number;
    accessDenied: number;
    passwordResets: number;
    disabledUsers: number;
    lockedAdmins: number;
  };
  daily: { date: string; succeeded: number; failed: number }[];
  failureReasons: { reason: string; count: number }[];
  topFailedIps: { ip: string; failures: number; accounts: number; lastAt: string }[];
  targetedAccounts: { account: string; failures: number; lastAt: string }[];
}

export interface SecurityEvent {
  id: string;
  event: string;
  outcome: 'SUCCESS' | 'FAILURE';
  createdAt: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  user: { id: string; name: string; email: string } | null;
  email: string | null;
  admin: { username: string } | null;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
}

export type UserStatusFilter = 'all' | 'active' | 'disabled' | 'unverified';
export type UserSort = 'newest' | 'oldest' | 'name' | 'last_seen';
export type SecurityCategory = 'all' | 'sign_in' | 'account' | 'admin' | 'access';
