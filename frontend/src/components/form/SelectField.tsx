import { type SelectHTMLAttributes, useId } from 'react';

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: readonly string[];
  placeholder?: string;
  error?: string;
}

/** Labelled select with accessible error wiring; the placeholder option has an empty value. */
export function SelectField({
  label,
  options,
  placeholder,
  error,
  ...selectProps
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...selectProps}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
