import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../features/auth/auth-context';
import { Avatar } from '../Avatar';
import {
  CloseIcon,
  DashboardIcon,
  LogoutIcon,
  MenuIcon,
  PlusIcon,
  ReportIcon,
  SearchIcon,
  SheetIcon,
  TasksIcon,
  UserIcon,
} from '../icons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Not highlighted on paths starting with this (a more specific item covers them). */
  exclude?: string;
}

const NAV_SECTIONS: { title: string; links: NavItem[] }[] = [
  { title: 'Overview', links: [{ to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> }] },
  {
    title: 'Work',
    links: [
      // Also active on a task's detail page, but not on "Add task".
      { to: '/tasks', label: 'Tasks', icon: <TasksIcon />, exclude: '/tasks/new' },
      { to: '/tasks/new', label: 'Add task', icon: <PlusIcon /> },
      { to: '/report', label: 'Work report', icon: <ReportIcon /> },
      { to: '/workbooks', label: 'Workbooks', icon: <SheetIcon /> },
    ],
  },
  { title: 'Account', links: [{ to: '/profile', label: 'Profile', icon: <UserIcon /> }] },
];

/**
 * Shell for signed-in pages: a sidebar with the main navigation (an off-canvas drawer on small
 * screens) and a top bar with task search, the current user and sign-out.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Escape closes the drawer on small screens.
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

  if (!user) {
    return null;
  }

  function signOut() {
    setSigningOut(true);
    // Clearing the user makes ProtectedRoute redirect to /login.
    logout().catch(() => undefined);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const term = search.trim();
    void navigate(term ? `/tasks?${new URLSearchParams({ search: term }).toString()}` : '/tasks');
    setSearch('');
  }

  const closeNav = () => setNavOpen(false);

  return (
    <div className={`shell${navOpen ? ' shell--nav-open' : ''}`}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <aside className="sidebar" id="sidebar" aria-label="Sidebar">
        <div className="sidebar-head">
          <Link to="/dashboard" className="sidebar-brand" onClick={closeNav}>
            <span className="brand-logo" aria-hidden="true">
              DT
            </span>
            <span>Daily Task Update</span>
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
          <Avatar user={user} />
          <div className="sidebar-user-text">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="sidebar-section">
              <p className="sidebar-section-title">{section.title}</p>
              {section.links.map((link) => {
                const excluded = link.exclude !== undefined && pathname.startsWith(link.exclude);
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    onClick={closeNav}
                    className={({ isActive }) => (isActive && !excluded ? 'active' : undefined)}
                    aria-current={excluded ? false : undefined}
                  >
                    {link.icon}
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="sidebar-backdrop" onClick={closeNav} aria-hidden="true" />

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar-menu"
            aria-label="Open menu"
            aria-controls="sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <MenuIcon />
          </button>

          <form className="topbar-search" role="search" onSubmit={onSearch}>
            <SearchIcon />
            <input
              type="search"
              aria-label="Find tasks"
              placeholder="Find tasks by name or #number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
            />
          </form>

          <div className="topbar-user">
            <Link to="/profile" className="topbar-profile" aria-label="Your profile">
              <Avatar user={user} />
              <span className="topbar-name" data-testid="current-user">
                {user.name}
              </span>
            </Link>
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
