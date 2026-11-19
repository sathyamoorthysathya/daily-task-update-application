import { Navigate, Outlet, useLocation } from 'react-router';
import { AppShellSkeleton, AuthSkeleton } from '../../../components/Skeletons';
import { useAuth } from '../auth-context';

/** Renders child routes only for signed-in users; otherwise redirects to /login. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    // Preview of the signed-in layout while the session is checked.
    return <AppShellSkeleton />;
  }
  if (status === 'unauthenticated') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}

/** Sign-in/registration pages: signed-in users go straight to the dashboard. */
export function GuestRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <AuthSkeleton />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
