import { TASK_STATUSES } from '../../tasks/task-status';
import type { ActivityDay, StatusCounts } from '../dashboard.api';

const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });

/** Small bar chart for stat cards (decorative: the card shows the number in text). */
export function Sparkbars({ values, tone }: { values: number[]; tone: string }) {
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 36;
  const slot = width / Math.max(1, values.length);
  return (
    <svg
      className={`sparkbars sparkbars--${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {values.map((value, index) => {
        const barHeight = value === 0 ? 1.5 : Math.max(3, (value / max) * height);
        return (
          <rect
            key={index}
            x={index * slot + slot * 0.2}
            y={height - barHeight}
            width={slot * 0.6}
            height={barHeight}
            rx={1.2}
            className={value === 0 ? 'sparkbar sparkbar--empty' : 'sparkbar'}
          />
        );
      })}
    </svg>
  );
}

/**
 * Entries per day, with the completed part of each day stacked at the bottom. Screen readers
 * get the same numbers as a table.
 */
export function ActivityChart({ days }: { days: ActivityDay[] }) {
  const width = 640;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(4, ...days.map((day) => day.entries));
  // Round the scale up to a multiple of 4 so the 4 grid lines get whole numbers.
  const top = Math.ceil(max / 4) * 4;
  const slot = plotW / days.length;
  const barW = Math.min(28, slot * 0.6);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const total = days.reduce((sum, day) => sum + day.entries, 0);
  const first = days[0];
  const last = days.at(-1);

  return (
    <figure className="activity-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Entries per day: ${total} in the last ${days.length} days`}
      >
        {[0, 1, 2, 3, 4].map((step) => {
          const value = (top / 4) * step;
          return (
            <g key={step} className="chart-grid">
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
              <text x={pad.left - 8} y={y(value) + 4} textAnchor="end">
                {value}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2;
          const other = day.entries - day.completed;
          return (
            <g key={day.date}>
              <title>
                {`${dayLabel(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${day.entries} entries, ${day.completed} completed`}
              </title>
              {day.completed > 0 && (
                <rect
                  className="chart-bar chart-bar--completed"
                  x={x}
                  y={y(day.completed)}
                  width={barW}
                  height={y(0) - y(day.completed)}
                  rx={3}
                />
              )}
              {other > 0 && (
                <rect
                  className="chart-bar chart-bar--entries"
                  x={x}
                  y={y(day.entries)}
                  width={barW}
                  height={y(day.completed) - y(day.entries)}
                  rx={3}
                />
              )}
              {(index % 2 === days.length % 2 || days.length <= 10) && (
                <text className="chart-axis" x={x + barW / 2} y={height - 8} textAnchor="middle">
                  {dayLabel(day.date, { day: 'numeric' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--entries" /> Other entries
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch--completed" /> Completed
        </span>
        {first && last && (
          <span className="muted chart-range">
            {dayLabel(first.date, { month: 'short', day: 'numeric' })} –{' '}
            {dayLabel(last.date, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </figcaption>
      <table className="visually-hidden">
        <caption>Entries per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Entries</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{day.date}</td>
              <td>{day.entries}</td>
              <td>{day.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Donut of tasks by status, with a legend giving every count and share. */
export function StatusDonut({ counts }: { counts: StatusCounts }) {
  const total = TASK_STATUSES.reduce((sum, status) => sum + counts[status.value], 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="status-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${total} tasks by status`}>
        <circle className="donut-track" cx="70" cy="70" r={radius} />
        {total > 0 &&
          TASK_STATUSES.map((status) => {
            const length = (counts[status.value] / total) * circumference;
            const segment = (
              <circle
                key={status.value}
                className={`donut-segment tone-${status.value.toLowerCase()}`}
                cx="70"
                cy="70"
                r={radius}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += length;
            return segment;
          })}
        <text x="70" y="68" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="70" y="88" textAnchor="middle" className="donut-caption">
          {total === 1 ? 'task' : 'tasks'}
        </text>
      </svg>
      <ul className="donut-legend" aria-label="Status breakdown">
        {TASK_STATUSES.map((status) => (
          <li key={status.value}>
            <span className={`legend-dot tone-${status.value.toLowerCase()}`} aria-hidden="true" />
            <span className="donut-legend-label">{status.label}</span>
            <span className="donut-legend-value">
              {counts[status.value]}
              <span className="muted">
                {' '}
                ({total === 0 ? 0 : Math.round((counts[status.value] / total) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
