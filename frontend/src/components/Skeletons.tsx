import type { CSSProperties, ReactNode } from 'react';

/**
 * Loading previews ("skeletons"): grey shimmering shapes laid out like the page that is
 * loading, so the page appears at once and fills in when the data arrives. Each preview is
 * announced to screen readers with its label. (A slow connection is announced app-wide by
 * NetworkStatus.)
 *
 * Each page has its shapes (`…Bones`), used twice: inside the page while its data loads
 * (`TaskListSkeleton`, ...), and as the whole page, with a heading, while the page's own code
 * is still downloading (`PageSkeleton`).
 */

interface BoneProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  /** circle: avatars and icons; pill: badges and buttons. */
  shape?: 'line' | 'block' | 'circle' | 'pill';
  className?: string;
}

/** One grey placeholder shape. */
function Bone({ width = '100%', height = 14, shape = 'line', className = '' }: BoneProps) {
  return (
    <span
      className={`skeleton skeleton-bone skeleton-bone--${shape} ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

interface FrameProps {
  /** Announced to screen readers, e.g. "Loading tasks…". */
  label: string;
  className?: string;
  children: ReactNode;
}

/** Wraps a preview: a live region with the label, the shapes hidden from screen readers. */
function SkeletonFrame({ label, className, children }: FrameProps) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {/* display: contents, so the frame's own layout (grid, flex) places the shapes. */}
      <div className="skeleton-shapes" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** Heading and subtitle of a page. */
function HeaderBones({ title = '40%' }: { title?: CSSProperties['width'] }) {
  return (
    <div className="skeleton-header">
      <Bone width={title} height={30} />
      <Bone width="60%" />
    </div>
  );
}

/** A labelled input. */
function FieldBones({ wide = false, tall = false }: { wide?: boolean; tall?: boolean }) {
  return (
    <div className={`skeleton-field${wide ? ' field--wide' : ''}`}>
      <Bone width="35%" height={12} />
      <Bone height={tall ? 96 : 40} shape="block" />
    </div>
  );
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

// ------------------------------------------------------------------ Shapes of each page

function DashboardBones() {
  return (
    <>
      <Bone height={180} shape="block" className="skeleton-gap" />
      <div className="stat-grid skeleton-gap">
        {range(4).map((i) => (
          <div key={i} className="stat-card skeleton" />
        ))}
      </div>
      <Bone height={240} shape="block" className="skeleton-gap" />
    </>
  );
}

function TaskRowsBones() {
  return (
    <div className="skeleton-rows">
      <Bone width="25%" height={12} />
      {range(6).map((i) => (
        <div key={i} className="skeleton-row">
          <Bone width={36} height={20} shape="pill" />
          <div className="skeleton-stack skeleton-grow">
            <Bone width={`${55 - (i % 3) * 10}%`} height={16} />
            <Bone width={`${80 - (i % 2) * 15}%`} height={12} />
          </div>
          <Bone width={90} height={24} shape="pill" />
          <Bone width={80} height={12} className="skeleton-hide-narrow" />
        </div>
      ))}
    </div>
  );
}

function TaskDetailBones() {
  return (
    <div className="skeleton-page">
      <Bone width={160} height={12} />
      <div className="skeleton-header skeleton-header--bar">
        <div className="skeleton-stack skeleton-grow">
          <Bone width="50%" height={30} />
          <Bone width="35%" />
        </div>
        <Bone width={90} height={38} shape="block" />
        <Bone width={90} height={38} shape="block" />
      </div>
      <div className="task-layout">
        <div className="task-main">
          <div className="card skeleton-stack">
            <Bone width="30%" height={20} />
            <Bone width="55%" height={12} />
            {range(2).map((i) => (
              <div key={i} className="skeleton-entry">
                <div className="skeleton-row">
                  <Bone width={120} height={16} />
                  <Bone width={90} height={24} shape="pill" />
                </div>
                <Bone width="95%" />
                <Bone width="70%" />
              </div>
            ))}
          </div>
        </div>
        <div className="card skeleton-stack">
          <Bone width="45%" height={20} />
          {range(5).map((i) => (
            <div key={i} className="skeleton-stack">
              <Bone width="35%" height={10} />
              <Bone width="65%" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkbookCardsBones() {
  return (
    <div className="workbook-list skeleton-list">
      {range(2).map((i) => (
        <div key={i} className="card workbook-card">
          <div className="workbook-card-main">
            <Bone width={44} height={44} shape="block" />
            <div className="skeleton-stack skeleton-grow">
              <Bone width="40%" height={20} />
              <Bone width="65%" height={12} />
              <Bone width={110} height={22} shape="pill" />
            </div>
          </div>
          <div className="skeleton-row">
            {range(4).map((j) => (
              <Bone key={j} width={96} height={36} shape="block" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateWorkbookBones() {
  return (
    <div className="skeleton-page">
      <HeaderBones />
      <div className="card skeleton-stack">
        <FieldBones />
        <FieldBones />
        <Bone width={170} height={42} shape="block" />
      </div>
      <div className="card skeleton-stack">
        <Bone width="25%" height={20} />
        <Bone width="70%" />
        <Bone height={64} shape="block" />
      </div>
    </div>
  );
}

function TaskFormBones() {
  return (
    <div className="card skeleton-form-grid">
      <FieldBones wide />
      <div className="field--wide skeleton-stack">
        <Bone width="15%" height={20} />
        <Bone width="35%" height={12} />
      </div>
      <FieldBones />
      <FieldBones />
      <FieldBones wide />
      <FieldBones />
      <FieldBones />
      <div className="field--wide skeleton-stack">
        <Bone width="15%" height={20} />
        <Bone width="45%" height={12} />
      </div>
      <FieldBones wide tall />
      <FieldBones />
      <FieldBones />
      <Bone width={130} height={42} shape="block" />
    </div>
  );
}

function ProfileBones() {
  return (
    <div className="skeleton-page">
      <div className="card skeleton-row skeleton-profile">
        <Bone width={72} height={72} shape="circle" />
        <div className="skeleton-stack skeleton-grow">
          <Bone width="35%" height={22} />
          <Bone width="45%" />
          <Bone width="30%" height={12} />
        </div>
        <Bone width={130} height={38} shape="block" className="skeleton-hide-narrow" />
      </div>
      <div className="card skeleton-form-grid">
        <div className="field--wide skeleton-stack">
          <Bone width="25%" height={20} />
          <Bone width="45%" height={12} />
        </div>
        {range(6).map((i) => (
          <FieldBones key={i} />
        ))}
      </div>
    </div>
  );
}

function ReportBones() {
  return (
    <div className="skeleton-page skeleton-gap">
      <div className="skeleton-totals">
        {range(5).map((i) => (
          <div key={i} className="card skeleton-stack">
            <Bone width="60%" height={12} />
            <Bone width="40%" height={26} />
          </div>
        ))}
      </div>
      <div className="card skeleton-stack">
        <Bone width="20%" height={20} />
        <Bone width="45%" height={12} />
        {range(5).map((i) => (
          <div key={i} className="skeleton-row">
            <Bone width="30%" />
            <Bone width="15%" />
            <Bone width="20%" />
            <Bone width="15%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthCardBones() {
  return (
    <div className="auth-card">
      <div className="skeleton-auth-head">
        <Bone width={44} height={44} shape="block" />
        <Bone width="55%" height={26} />
        <Bone width="75%" />
      </div>
      <div className="skeleton-stack skeleton-gap">
        <FieldBones />
        <FieldBones />
        <Bone height={44} shape="block" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ App start-up

/** The signed-in layout (sidebar, top bar, dashboard-like content) while the session loads. */
export function AppShellSkeleton() {
  return (
    <SkeletonFrame label="Loading…" className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Bone width={36} height={36} shape="block" />
          <Bone width="60%" height={18} />
        </div>
        <div className="skeleton-sidebar-user">
          <Bone width={40} height={40} shape="circle" />
          <div className="skeleton-stack skeleton-grow">
            <Bone width="70%" />
            <Bone width="90%" height={10} />
          </div>
        </div>
        <div className="skeleton-stack skeleton-nav">
          {range(6).map((i) => (
            <Bone key={i} width={`${70 - (i % 3) * 10}%`} height={18} />
          ))}
        </div>
      </aside>
      <div className="shell-main">
        <div className="topbar">
          <Bone width="min(420px, 50%)" height={40} shape="block" />
          <Bone width={140} height={36} shape="pill" className="skeleton-push" />
        </div>
        <div className="shell-content">
          <div className="app app--wide">
            <HeaderBones title="30%" />
            <DashboardBones />
          </div>
        </div>
      </div>
    </SkeletonFrame>
  );
}

/** Sign-in / registration card while the session is checked. */
export function AuthSkeleton() {
  return (
    <SkeletonFrame label="Loading…" className="auth-page">
      <AuthCardBones />
    </SkeletonFrame>
  );
}

// ------------------------------------------------------------------ Inside pages (data)

/** Rows of the task list (inside its card). */
export function TaskListSkeleton() {
  return (
    <SkeletonFrame label="Loading tasks…">
      <TaskRowsBones />
    </SkeletonFrame>
  );
}

/** A task's page: breadcrumb, title, its daily entries and its details. */
export function TaskDetailSkeleton() {
  return (
    <SkeletonFrame label="Loading task…">
      <TaskDetailBones />
    </SkeletonFrame>
  );
}

/** Workbook cards. */
export function WorkbookListSkeleton() {
  return (
    <SkeletonFrame label="Loading workbooks…">
      <WorkbookCardsBones />
    </SkeletonFrame>
  );
}

/** "Create workbook": the name form and the sheet preview. */
export function CreateWorkbookSkeleton() {
  return (
    <SkeletonFrame label="Loading…">
      <CreateWorkbookBones />
    </SkeletonFrame>
  );
}

/** The "New task" form. */
export function TaskFormSkeleton() {
  return (
    <SkeletonFrame label="Loading…">
      <TaskFormBones />
    </SkeletonFrame>
  );
}

/** Profile: the summary card and the details form. */
export function ProfileSkeleton() {
  return (
    <SkeletonFrame label="Loading your profile…">
      <ProfileBones />
    </SkeletonFrame>
  );
}

/** Work report: the totals and the tasks table. */
export function ReportSkeleton() {
  return (
    <SkeletonFrame label="Loading the report…">
      <ReportBones />
    </SkeletonFrame>
  );
}

/** "Recent entries" rows on the New task page. */
export function RecentEntriesSkeleton() {
  return (
    <SkeletonFrame label="Loading recent entries…" className="skeleton-rows">
      {range(3).map((i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-stack skeleton-grow">
            <Bone width={`${50 - i * 8}%`} height={16} />
            <Bone width="75%" height={12} />
          </div>
          <Bone width={90} height={24} shape="pill" />
        </div>
      ))}
    </SkeletonFrame>
  );
}

/** Admin panel: key figures and two charts. */
function AdminBones() {
  return (
    <>
      <div className="stat-grid skeleton-gap">
        {range(4).map((i) => (
          <div key={i} className="stat-card skeleton" />
        ))}
      </div>
      <Bone height={260} shape="block" className="skeleton-gap" />
      <Bone height={200} shape="block" className="skeleton-gap" />
    </>
  );
}

/** Admin panel: filters and a table. */
function AdminTableBones() {
  return (
    <div className="skeleton-page skeleton-gap">
      <Bone height={56} shape="block" />
      <div className="card">
        <TaskRowsBones />
      </div>
    </div>
  );
}

/** Admin data inside a page (while it loads). */
export function AdminDataSkeleton({ table = false }: { table?: boolean }) {
  return (
    <SkeletonFrame label="Loading…">{table ? <AdminTableBones /> : <AdminBones />}</SkeletonFrame>
  );
}

// ------------------------------------------------------------------ Whole pages (code)

export type PageSkeletonKind =
  | 'auth'
  | 'dashboard'
  | 'tasks'
  | 'task'
  | 'new-task'
  | 'workbooks'
  | 'new-workbook'
  | 'profile'
  | 'report'
  | 'admin'
  | 'admin-table';

/** Page layout (`.app` modifier) and body of each page's preview. */
const PAGES: Record<Exclude<PageSkeletonKind, 'auth'>, { app: string; body: ReactNode }> = {
  dashboard: { app: 'app--dashboard', body: <DashboardBones /> },
  tasks: {
    app: 'app--tasks',
    body: (
      <div className="skeleton-page skeleton-gap">
        <Bone height={76} shape="block" />
        <div className="card">
          <TaskRowsBones />
        </div>
      </div>
    ),
  },
  task: { app: 'app--task', body: <TaskDetailBones /> },
  'new-task': { app: 'app--wide', body: <TaskFormBones /> },
  workbooks: { app: 'app--wide', body: <WorkbookCardsBones /> },
  'new-workbook': { app: '', body: <CreateWorkbookBones /> },
  profile: { app: 'app--wide', body: <ProfileBones /> },
  report: { app: 'app--report', body: <ReportBones /> },
  admin: { app: 'app--wide app--admin', body: <AdminBones /> },
  'admin-table': { app: 'app--wide app--admin', body: <AdminTableBones /> },
};

/** A whole page (heading and body) while its code downloads, e.g. on a slow network. */
export function PageSkeleton({ page }: { page: PageSkeletonKind }) {
  if (page === 'auth') {
    return <AuthSkeleton />;
  }
  const { app, body } = PAGES[page];
  // The task page and "create workbook" draw their own heading shapes.
  const ownHeader = page === 'task' || page === 'new-workbook';
  return (
    <SkeletonFrame label="Loading…" className={`app ${app}`.trim()}>
      {!ownHeader && <HeaderBones title="30%" />}
      {body}
    </SkeletonFrame>
  );
}
