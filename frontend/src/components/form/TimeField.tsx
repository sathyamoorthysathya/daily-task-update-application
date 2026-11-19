import { useId } from 'react';

interface TimeFieldProps {
  label: string;
  name?: string;
  /** "HH:MM" on the 24-hour clock (what the API stores), or "" when not set. */
  value: string;
  /** Called like an input's onChange, with the new "HH:MM" value ("" when cleared). */
  onChange: (event: { target: { value: string } }) => void;
  error?: string;
  hint?: string;
}

/** Minutes between the times offered in the list. */
const STEP_MINUTES = 15;

/** Parts of the day, in the order shown: the list opens at working hours, night comes last. */
const PARTS_OF_DAY = [
  { label: 'Morning', from: 6, to: 12 },
  { label: 'Afternoon', from: 12, to: 17 },
  { label: 'Evening', from: 17, to: 24 },
  { label: 'Night', from: 0, to: 6 },
];

const pad = (value: number) => String(value).padStart(2, '0');

/** "14:05" → "2:05 PM" */
function formatTime12h(value: string): string {
  const hour = Number(value.slice(0, 2));
  return `${hour % 12 === 0 ? 12 : hour % 12}:${value.slice(3, 5)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Every STEP_MINUTES from 00:00 to 23:45, as "HH:MM". */
const TIMES = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, index) => {
  const minutes = index * STEP_MINUTES;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
});

const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/**
 * Time of day as one drop-down of 12-hour times ("9:30 AM") every 15 minutes, grouped into
 * morning, afternoon, evening and night. It looks the same whatever the computer's regional
 * settings are (never 24-hour "railway" time). The value it reports is still "HH:MM" on the
 * 24-hour clock. A saved time that is not on the 15-minute grid (e.g. 9:07) is still offered.
 */
export function TimeField({ label, name, value, onChange, error, hint }: TimeFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  const times = isTime(value) && !TIMES.includes(value) ? [...TIMES, value].sort() : TIMES;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        className="time-select"
        value={isTime(value) ? value : ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange({ target: { value: event.target.value } })}
      >
        <option value="">Not set</option>
        {PARTS_OF_DAY.map((part) => (
          <optgroup key={part.label} label={part.label}>
            {times
              .filter((time) => {
                const hour = Number(time.slice(0, 2));
                return hour >= part.from && hour < part.to;
              })
              .map((time) => (
                <option key={time} value={time}>
                  {formatTime12h(time)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {hint && !error && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
