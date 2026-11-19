import { type ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { preloadAdminPages } from '../../../app/page-loaders';
import {
  ActivityIcon,
  CloseIcon,
  DashboardIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
} from '../../../components/icons';
import { useAdminAuth } from '../admin-auth-context';
import { initials } from '../format';

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', icon: <DashboardIcon />, end: true },
  { to: '/admin/users', label: 'Users', icon: <UsersIcon /> },
  { to: '/admin/activity', label: 'Page visits', icon: <ActivityIcon /> },
  { to: '/admin/security', label: 'Security', icon: <ShieldIcon /> },
  { to: '/admin/settings', label: 'Admin settings', icon: <SettingsIcon /> },
];

/** Shell of the admin panel: the same structure as the app, marked clearly as "Admin". */
export function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(preloadAdminPages, []);

  useEffect(() => {
    if (!navOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  if (!admin) {
    return null;
  }

  const closeNav = () => setNavOpen(false);
  const signOut = () => {
    setSigningOut(true);
    logout().catch(() => undefined);
  };

  return (
    <div className={`shell shell--admin${navOpen ? ' shell--nav-open' : ''}`}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <aside className="sidebar" id="admin-sidebar" aria-label="Admin sidebar">
        <div className="sidebar-head">
          <Link to="/admin" className="sidebar-brand" onClick={closeNav}>
            <span className="brand-logo" aria-hidden="true">
              DT
            </span>
            <span>
              Daily Task Update <span className="admin-badge">Admin</span>
            </span>
          </Link>
          <button
            type="button"
            className="icon-button sidebar-close"
            aria-label="Close menu"
            onClick={closeNav}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="sidebar-user">
          <span className="avatar admin-avatar" aria-hidden="true">
            {initials(admin.displayName)}
          </span>
          <div className="sidebar-user-text">
            <span className="sidebar-user-name">{admin.displayName}</span>
            <span className="sidebar-user-email">@{admin.username}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Admin">
          <div className="sidebar-section">
            <p className="sidebar-section-title">Admin panel</p>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={closeNav}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </aside>

      <div className="sidebar-backdrop" onClick={closeNav} aria-hidden="true" />

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar-menu"
            aria-label="Open menu"
            aria-controls="admin-sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <MenuIcon />
          </button>
          <p className="admin-topbar-note">
            <ShieldIcon />
            {admin.twoFactorEnabled ? (
              <span>Signed in with two-step verification</span>
            ) : (
              <Link to="/admin/settings#two-step">Turn on two-step verification</Link>
            )}
          </p>
          <div className="topbar-user">
            <span className="topbar-name" data-testid="current-admin">
              {admin.displayName}
            </span>
            <button
              type="button"
              className="button topbar-signout"
              aria-label="Sign out"
              onClick={signOut}
              disabled={signingOut}
            >
              <LogoutIcon />
              <span>Sign out</span>
            </button>
          </div>
        </header>

        <div className="shell-content" id="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
