import type { ReactNode } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { formatNumber } from '../format';

const PERIODS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

/** Period buttons (7 / 30 / 90 days). */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Period">
      {PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          className={`segmented-option${period.value === value ? ' is-current' : ''}`}
          aria-pressed={period.value === value}
          onClick={() => onChange(period.value)}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

/** Segmented filter with any options. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented-option${option.value === value ? ' is-current' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "Showing 21–40 of 132" with Previous / Next. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
}) {
  if (total === 0) {
    return null;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label={label}>
      <p className="muted" aria-live="polite">
        Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </p>
      <div className="pagination-pages">
        <button
          type="button"
          className="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="muted">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/** Error with a "Try again" button. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <FormAlert variant="error">
      {message}{' '}
      <button type="button" className="button button--subtle" onClick={onRetry}>
        Try again
      </button>
    </FormAlert>
  );
}

/** Small coloured label: good / bad / neutral / info. */
export function Pill({
  tone,
  children,
}: {
  tone: 'good' | 'bad' | 'neutral' | 'info' | 'warn';
  children: ReactNode;
}) {
  return <span className={`admin-pill admin-pill--${tone}`}>{children}</span>;
}

/** Page title block of every admin page. */
export function AdminHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children && <div className="admin-header-actions">{children}</div>}
    </header>
  );
}

/** A key figure (label, number, note). */
export function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note?: ReactNode;
  tone?: 'bad' | 'warn';
}) {
  return (
    <div className={`admin-figure${tone ? ` admin-figure--${tone}` : ''}`}>
      <span className="admin-figure-label">{label}</span>
      <span className="admin-figure-value">
        {typeof value === 'number' ? formatNumber(value) : value}
      </span>
      {note && <span className="admin-figure-note">{note}</span>}
    </div>
  );
}
