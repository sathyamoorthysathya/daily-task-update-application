import type { ReactNode } from 'react';
import { Sparkbars } from './charts';

interface Props {
  label: string;
  value: number | string;
  icon: ReactNode;
  /** Colour theme: entries, week, completed, open. */
  tone: 'entries' | 'week' | 'completed' | 'open';
  /** Daily values for the small chart. */
  trend: number[];
  footnote: ReactNode;
}

/** A key figure with an icon, a small daily chart and a footnote. */
export function StatCard({ label, value, icon, tone, trend, footnote }: Props) {
  return (
    <article className={`stat-card stat-card--${tone}`} aria-label={label}>
      <div className="stat-card-head">
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 className="stat-label">{label}</h2>
      </div>
      <div className="stat-body">
        <Sparkbars values={trend} tone={tone} />
        <p className="stat-value">{value}</p>
      </div>
      <p className="stat-footnote">{footnote}</p>
    </article>
  );
}
