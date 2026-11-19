/**
 * Every page is its own JavaScript file, downloaded the first time it is needed (smaller
 * first download, faster start on a slow network). `preloadPages` fetches the rest in the
 * background once the app is running, so moving between pages stays instant.
 */
export const pageLoaders = {
  login: () => import('../features/auth/pages/LoginPage'),
  register: () => import('../features/auth/pages/RegisterPage'),
  forgotPassword: () => import('../features/auth/pages/ForgotPasswordPage'),
  resetPassword: () => import('../features/auth/pages/ResetPasswordPage'),
  dashboard: () => import('../features/dashboard/DashboardPage'),
  profile: () => import('../features/profile/ProfilePage'),
  workbooks: () => import('../features/workbooks/pages/WorkbooksPage'),
  createWorkbook: () => import('../features/workbooks/pages/CreateWorkbookPage'),
  tasks: () => import('../features/tasks/pages/TasksPage'),
  newTask: () => import('../features/tasks/pages/NewTaskPage'),
  taskDetail: () => import('../features/tasks/pages/TaskDetailPage'),
  report: () => import('../features/reports/ReportPage'),
};

/**
 * Admin panel pages: never downloaded by the app itself (only when /admin is opened), and
 * preloaded by the admin layout.
 */
export const adminPageLoaders = {
  root: () => import('../features/admin/AdminRoutes'),
  login: () => import('../features/admin/pages/AdminLoginPage'),
  overview: () => import('../features/admin/pages/AdminOverviewPage'),
  users: () => import('../features/admin/pages/AdminUsersPage'),
  user: () => import('../features/admin/pages/AdminUserDetailPage'),
  activity: () => import('../features/admin/pages/AdminActivityPage'),
  security: () => import('../features/admin/pages/AdminSecurityPage'),
  settings: () => import('../features/admin/pages/AdminSettingsPage'),
};

interface NetworkInformation {
  saveData?: boolean;
}

const preloaded = new Set<object>();

/** Downloads every page in the background (once; not when the user asked to save data). */
export function preloadPages(loaders: Record<string, () => Promise<unknown>> = pageLoaders): void {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (preloaded.has(loaders) || connection?.saveData) {
    return;
  }
  preloaded.add(loaders);
  const run = () => {
    for (const load of Object.values(loaders)) {
      // A failure only means the page is downloaded later, when it is opened.
      load().catch(() => undefined);
    }
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1000);
  }
}

/** The admin panel's pages (from the admin layout). */
export function preloadAdminPages(): void {
  preloadPages(adminPageLoaders);
}
