import { useEffect, useRef, useState } from 'react';
import { dayLabel, formatNumber } from '../format';

/**
 * Width the chart is shown at, so it is drawn at that size: axis text stays readable in a
 * half-width card or on a phone instead of being scaled down with the whole drawing.
 */
function useChartWidth(fallback = 640) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0);
      if (measured > 0) {
        setWidth(Math.max(240, measured));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

interface Series<T> {
  key: keyof T & string;
  label: string;
  /** CSS class colouring the bars (and the legend swatch). */
  tone: 'accent' | 'danger';
}

interface DailyBarsProps<T extends { date: string }> {
  days: T[];
  /** One series = plain bars; two = stacked (the first at the bottom), with a legend. */
  series: Series<T>[];
  /** Names the chart for screen readers, e.g. "Page views per day". */
  title: string;
}

/**
 * Bars per day. Every bar has a hover tooltip (title), and screen readers get the numbers as
 * a table. Bars are thin with rounded tops; the grid stays in the background.
 */
export function DailyBars<T extends { date: string }>({ days, series, title }: DailyBarsProps<T>) {
  const { ref, width } = useChartWidth();
  const height = width < 420 ? 170 : 200;
  const pad = { top: 10, right: 6, bottom: 26, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const value = (day: T, key: keyof T) => Number(day[key] ?? 0);
  const totalOf = (day: T) => series.reduce((sum, s) => sum + value(day, s.key), 0);
  const max = Math.max(4, ...days.map(totalOf));
  const top = Math.ceil(max / 4) * 4;
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(22, slot * 0.62));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  // One date label per ~56px, whatever the period and the width.
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(3, Math.floor(plotW / 56))));
  const grand = days.reduce((sum, day) => sum + totalOf(day), 0);

  return (
    <figure className="admin-chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}: ${formatNumber(grand)} in ${days.length} days`}
      >
        {[0, 1, 2, 3, 4].map((step) => {
          const v = (top / 4) * step;
          return (
            <g key={step} className="chart-grid">
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end">
                {formatNumber(v)}
              </text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2;
          let base = 0;
          const tooltip = `${dayLabel(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${series
            .map((s) => `${formatNumber(value(day, s.key))} ${s.label.toLowerCase()}`)
            .join(', ')}`;
          return (
            <g key={day.date} className="admin-chart-day">
              <title>{tooltip}</title>
              {/* Hover target: the whole column, bigger than the bar. */}
              <rect
                className="admin-chart-hit"
                x={pad.left + index * slot}
                y={pad.top}
                width={slot}
                height={plotH}
              />
              {series.map((s, seriesIndex) => {
                const v = value(day, s.key);
                if (v === 0) {
                  return null;
                }
                const y0 = y(base);
                base += v;
                const isTop =
                  seriesIndex === series.length - 1 ||
                  series.slice(seriesIndex + 1).every((next) => value(day, next.key) === 0);
                // 2px surface gap between stacked segments.
                const gap = seriesIndex > 0 ? 2 : 0;
                const h = Math.max(1, y0 - y(base) - gap);
                return (
                  <path
                    key={s.key}
                    className={`admin-bar admin-bar--${s.tone}`}
                    d={barPath(x, y(base), barW, h, isTop ? Math.min(4, barW / 2, h) : 0)}
                  />
                );
              })}
              {index % labelEvery === (days.length - 1) % labelEvery && (
                <text className="chart-axis" x={x + barW / 2} y={height - 8} textAnchor="middle">
                  {dayLabel(day.date, {
                    day: 'numeric',
                    month: days.length > 31 ? 'short' : undefined,
                  })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="chart-legend">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className={`legend-swatch admin-swatch--${s.tone}`} /> {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{day.date}</td>
              {series.map((s) => (
                <td key={s.key}>{value(day, s.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A bar whose top corners are rounded (radius r) and whose base sits flat on the axis. */
function barPath(x: number, top: number, w: number, h: number, r: number): string {
  const bottom = top + h;
  if (r <= 0) {
    return `M${x},${bottom}V${top}H${x + w}V${bottom}Z`;
  }
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
}

interface RankedItem {
  key: string;
  label: string;
  value: number;
  /** Second line, e.g. the route or "12 visitors". */
  note?: string;
}

/** Horizontal bars, largest first: share of the total for each item. */
export function RankedBars({
  items,
  unit,
  empty = 'No data yet.',
}: {
  items: RankedItem[];
  unit: string;
  empty?: string;
}) {
  if (items.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.value));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <ol className="ranked-bars">
      {items.map((item) => (
        <li key={item.key}>
          <div className="ranked-bars-text">
            <span className="ranked-bars-label">
              {item.label}
              {item.note && <span className="ranked-bars-note">{item.note}</span>}
            </span>
            <span className="ranked-bars-value">
              {formatNumber(item.value)} <span className="visually-hidden">{unit}</span>
              <span className="muted">
                {' '}
                ({total === 0 ? 0 : Math.round((item.value / total) * 100)}%)
              </span>
            </span>
          </div>
          <span className="ranked-bars-track" aria-hidden="true">
            <span className="ranked-bars-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Views per hour of the day: one cell per hour, darker = more (single hue). */
export function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const label = (hour: number) =>
    new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, {
      hour: 'numeric',
      timeZone: 'UTC',
    });
  const busiest = hours.indexOf(Math.max(...hours));
  return (
    <figure className="hour-strip">
      <div className="hour-strip-cells" role="img" aria-label="Page views by hour of the day">
        {hours.map((views, hour) => (
          <span
            key={hour}
            className="hour-strip-cell"
            title={`${label(hour)}: ${formatNumber(views)} views`}
            style={
              { '--level': views === 0 ? 0 : 0.15 + (views / max) * 0.85 } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="hour-strip-axis" aria-hidden="true">
        <span>{label(0)}</span>
        <span>{label(6)}</span>
        <span>{label(12)}</span>
        <span>{label(18)}</span>
        <span>{label(23)}</span>
      </div>
      {Math.max(...hours) > 0 && (
        <figcaption className="muted">
          Busiest hour: {label(busiest)} ({formatNumber(hours[busiest] ?? 0)} views)
        </figcaption>
      )}
      <table className="visually-hidden">
        <caption>Page views by hour of the day</caption>
        <tbody>
          {hours.map((views, hour) => (
            <tr key={hour}>
              <th scope="row">{label(hour)}</th>
              <td>{views}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
