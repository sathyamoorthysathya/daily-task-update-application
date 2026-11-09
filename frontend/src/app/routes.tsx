import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
import { GuestRoute, ProtectedRoute } from '../features/auth/components/RouteGuards';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { NewTaskPage } from '../features/tasks/pages/NewTaskPage';
import { TaskDetailPage } from '../features/tasks/pages/TaskDetailPage';
import { TasksPage } from '../features/tasks/pages/TasksPage';
import { CreateWorkbookPage } from '../features/workbooks/pages/CreateWorkbookPage';
import { WorkbooksPage } from '../features/workbooks/pages/WorkbooksPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    // Only for signed-out users.
    element: <GuestRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Reachable from the email link whether or not the user is signed in.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    // Requires a session.
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/workbooks', element: <WorkbooksPage /> },
          { path: '/workbooks/new', element: <CreateWorkbookPage /> },
          { path: '/tasks', element: <TasksPage /> },
          { path: '/tasks/new', element: <NewTaskPage /> },
          { path: '/tasks/:taskId', element: <TaskDetailPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
