import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { reportPageView } from './page-views';

/** Root route element: reports each page the user opens, then renders the page. */
export function PageViewTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    reportPageView(pathname);
  }, [pathname]);

  return <Outlet />;
}
