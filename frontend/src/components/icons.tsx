import type { ReactNode, SVGProps } from 'react';

/** Small line icons (24×24, inherit the text colour). Decorative: hidden from screen readers. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const DashboardIcon = () => (
  <Icon>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
  </Icon>
);

export const TasksIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SheetIcon = () => (
  <Icon>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 9h16M4 15h16M10 9v12" />
  </Icon>
);

export const ReportIcon = () => (
  <Icon>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M15 3v4h4M9 17v-3M12 17v-6M15 17v-4" />
  </Icon>
);

export const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </Icon>
);

export const PrinterIcon = () => (
  <Icon>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Icon>
);

export const ArrowRightIcon = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const LogoutIcon = () => (
  <Icon>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
);

export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.5 2.5L16 9.5" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const CalendarIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
