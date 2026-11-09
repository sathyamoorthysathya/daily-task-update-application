import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth-context';

function FullPageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

/** Renders child routes only for signed-in users; otherwise redirects to /login. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader />;
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
    return <FullPageLoader />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
