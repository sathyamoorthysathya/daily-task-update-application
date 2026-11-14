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

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

/** "14:05" → { hour: "2", minute: "05", period: "PM" }; "" → all empty. */
function split(value: string): { hour: string; minute: string; period: string } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return { hour: '', minute: '', period: '' };
  }
  const hour24 = Number(match[1]);
  return {
    hour: String(hour24 % 12 === 0 ? 12 : hour24 % 12),
    minute: match[2]!,
    period: hour24 < 12 ? 'AM' : 'PM',
  };
}

/** { hour: "2", minute: "05", period: "PM" } → "14:05" */
function join(hour: string, minute: string, period: string): string {
  const hour24 = (Number(hour) % 12) + (period === 'PM' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

/**
 * Time of day on the 12-hour clock: hour, minute and AM/PM. Unlike the browser's time input,
 * it looks the same whatever the computer's regional settings are (never 24-hour "railway"
 * time). The value it reports is still "HH:MM" on the 24-hour clock.
 */
export function TimeField({ label, name, value, onChange, error, hint }: TimeFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  const current = split(value);

  /** Choosing any part sets the time; the parts not chosen yet start at 9:00 AM. */
  function change(part: 'hour' | 'minute' | 'period', next: string) {
    if (part === 'hour' && next === '') {
      onChange({ target: { value: '' } });
      return;
    }
    const time = {
      hour: current.hour || '9',
      minute: current.minute || '00',
      period: current.period || 'AM',
      [part]: next,
    };
    onChange({ target: { value: join(time.hour, time.minute, time.period) } });
  }

  return (
    <div className="field">
      <span id={id} className="field-label">
        {label}
      </span>
      <div
        className="time-field"
        role="group"
        aria-labelledby={id}
        aria-describedby={describedBy}
        data-invalid={error ? true : undefined}
      >
        <select
          name={name ? `${name}Hour` : undefined}
          aria-label={`${label} hour`}
          aria-invalid={error ? true : undefined}
          value={current.hour}
          onChange={(event) => change('hour', event.target.value)}
        >
          <option value="">--</option>
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          name={name ? `${name}Minute` : undefined}
          aria-label={`${label} minute`}
          aria-invalid={error ? true : undefined}
          value={current.minute}
          onChange={(event) => change('minute', event.target.value)}
        >
          {current.minute === '' && <option value="">--</option>}
          {MINUTES.map((minute) => (
            <option key={minute} value={minute}>
              {minute}
            </option>
          ))}
        </select>
        <select
          name={name ? `${name}Period` : undefined}
          aria-label={`${label} AM or PM`}
          aria-invalid={error ? true : undefined}
          value={current.period}
          onChange={(event) => change('period', event.target.value)}
        >
          {current.period === '' && <option value="">--</option>}
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
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
