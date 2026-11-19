import { type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
import {
  AppShellSkeleton,
  AuthSkeleton,
  PageSkeleton,
  type PageSkeletonKind,
} from '../components/Skeletons';
import { PageViewTracker } from '../features/analytics/PageViewTracker';
import { GuestRoute, ProtectedRoute } from '../features/auth/components/RouteGuards';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { adminPageLoaders, pageLoaders } from './page-loaders';

/** A page component from its (lazily downloaded) module. */
const lazyPage = <M,>(load: () => Promise<M>, pick: (module: M) => ComponentType) =>
  lazy(async () => ({ default: pick(await load()) }));

const LoginPage = lazyPage(pageLoaders.login, (m) => m.LoginPage);
const RegisterPage = lazyPage(pageLoaders.register, (m) => m.RegisterPage);
const ForgotPasswordPage = lazyPage(pageLoaders.forgotPassword, (m) => m.ForgotPasswordPage);
const ResetPasswordPage = lazyPage(pageLoaders.resetPassword, (m) => m.ResetPasswordPage);
const DashboardPage = lazyPage(pageLoaders.dashboard, (m) => m.DashboardPage);
const ProfilePage = lazyPage(pageLoaders.profile, (m) => m.ProfilePage);
const WorkbooksPage = lazyPage(pageLoaders.workbooks, (m) => m.WorkbooksPage);
const CreateWorkbookPage = lazyPage(pageLoaders.createWorkbook, (m) => m.CreateWorkbookPage);
const TasksPage = lazyPage(pageLoaders.tasks, (m) => m.TasksPage);
const NewTaskPage = lazyPage(pageLoaders.newTask, (m) => m.NewTaskPage);
const TaskDetailPage = lazyPage(pageLoaders.taskDetail, (m) => m.TaskDetailPage);
const ReportPage = lazyPage(pageLoaders.report, (m) => m.ReportPage);

// Admin panel (its own sign-in; downloaded only when /admin is opened).
const AdminRoot = lazyPage(adminPageLoaders.root, (m) => m.AdminRoot);
const AdminProtectedRoute = lazyPage(adminPageLoaders.root, (m) => m.AdminProtectedRoute);
const AdminGuestRoute = lazyPage(adminPageLoaders.root, (m) => m.AdminGuestRoute);
const AdminLoginPage = lazyPage(adminPageLoaders.login, (m) => m.AdminLoginPage);
const AdminOverviewPage = lazyPage(adminPageLoaders.overview, (m) => m.AdminOverviewPage);
const AdminUsersPage = lazyPage(adminPageLoaders.users, (m) => m.AdminUsersPage);
const AdminUserDetailPage = lazyPage(adminPageLoaders.user, (m) => m.AdminUserDetailPage);
const AdminActivityPage = lazyPage(adminPageLoaders.activity, (m) => m.AdminActivityPage);
const AdminSecurityPage = lazyPage(adminPageLoaders.security, (m) => m.AdminSecurityPage);
const AdminSettingsPage = lazyPage(adminPageLoaders.settings, (m) => m.AdminSettingsPage);

/** While a page's code downloads, a preview of that page is shown in its place. */
const withPreview = (kind: PageSkeletonKind, page: ReactNode) => (
  <Suspense fallback={<PageSkeleton page={kind} />}>{page}</Suspense>
);

export const routes: RouteObject[] = [
  {
    // A page that cannot be downloaded (or crashes) shows a friendly page with "Try again".
    errorElement: <RouteErrorPage />,
    // Records which page is opened (page-visit analytics for the admin panel).
    element: <PageViewTracker />,
    children: [
      { path: '/', element: <Navigate to="/dashboard" replace /> },
      {
        // Only for signed-out users.
        element: <GuestRoute />,
        children: [
          { path: '/login', element: withPreview('auth', <LoginPage />) },
          { path: '/register', element: withPreview('auth', <RegisterPage />) },
          { path: '/forgot-password', element: withPreview('auth', <ForgotPasswordPage />) },
        ],
      },
      // Reachable from the email link whether or not the user is signed in.
      { path: '/reset-password', element: withPreview('auth', <ResetPasswordPage />) },
      {
        // Requires a session.
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: '/dashboard', element: withPreview('dashboard', <DashboardPage />) },
              { path: '/profile', element: withPreview('profile', <ProfilePage />) },
              { path: '/workbooks', element: withPreview('workbooks', <WorkbooksPage />) },
              {
                path: '/workbooks/new',
                element: withPreview('new-workbook', <CreateWorkbookPage />),
              },
              { path: '/tasks', element: withPreview('tasks', <TasksPage />) },
              { path: '/tasks/new', element: withPreview('new-task', <NewTaskPage />) },
              { path: '/tasks/:taskId', element: withPreview('task', <TaskDetailPage />) },
              { path: '/report', element: withPreview('report', <ReportPage />) },
            ],
          },
        ],
      },
      {
        path: '/admin',
        element: (
          <Suspense fallback={<AppShellSkeleton />}>
            <AdminRoot />
          </Suspense>
        ),
        children: [
          {
            path: 'login',
            element: (
              <Suspense fallback={<AuthSkeleton />}>
                <AdminGuestRoute />
              </Suspense>
            ),
            children: [{ index: true, element: withPreview('auth', <AdminLoginPage />) }],
          },
          {
            element: (
              <Suspense fallback={<AppShellSkeleton />}>
                <AdminProtectedRoute />
              </Suspense>
            ),
            children: [
              { index: true, element: withPreview('admin', <AdminOverviewPage />) },
              { path: 'users', element: withPreview('admin-table', <AdminUsersPage />) },
              { path: 'users/:userId', element: withPreview('admin', <AdminUserDetailPage />) },
              { path: 'activity', element: withPreview('admin', <AdminActivityPage />) },
              { path: 'security', element: withPreview('admin', <AdminSecurityPage />) },
              { path: 'settings', element: withPreview('admin', <AdminSettingsPage />) },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
