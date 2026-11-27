import { type Ref, useId } from 'react';
import { TASK_TYPES } from '../task-status';
import { TASK_TYPE_OTHER_MAX } from '../tasks.schemas';
import type { TaskType } from '../task.types';

interface TaskTypeFieldProps {
  taskType: '' | TaskType;
  taskTypeOther: string;
  onTypeChange: (taskType: '' | TaskType) => void;
  onOtherChange: (text: string) => void;
  error?: string;
  /** Error of the user's own type ("Other"). */
  otherError?: string;
  /** The box for the user's own type, e.g. to focus it once "Other" is chosen. */
  otherRef?: Ref<HTMLInputElement>;
}

/**
 * Task type drop-down. With "Other", a box for the user's own type appears in the same field,
 * next to it: "Other – Code review".
 */
export function TaskTypeField({
  taskType,
  taskTypeOther,
  onTypeChange,
  onOtherChange,
  error,
  otherError,
  otherRef,
}: TaskTypeFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const otherErrorId = `${id}-other-error`;
  const isOther = taskType === 'OTHER';

  return (
    <div className="field">
      <label htmlFor={id}>Task Type</label>
      <div className={isOther ? 'task-type-field task-type-field--other' : 'task-type-field'}>
        <select
          id={id}
          name="taskType"
          value={TASK_TYPES.find((type) => type.value === taskType)?.label ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) =>
            onTypeChange(TASK_TYPES.find((type) => type.label === event.target.value)?.value ?? '')
          }
        >
          <option value="">Not set</option>
          {TASK_TYPES.map((type) => (
            <option key={type.value} value={type.label}>
              {type.label}
            </option>
          ))}
        </select>
        {isOther && (
          <>
            <span className="task-type-field__dash" aria-hidden="true">
              -
            </span>
            <input
              ref={otherRef}
              name="taskTypeOther"
              aria-label="Your Task Type"
              maxLength={TASK_TYPE_OTHER_MAX}
              autoComplete="off"
              placeholder="e.g. Code review"
              value={taskTypeOther}
              aria-invalid={otherError ? true : undefined}
              aria-describedby={otherError ? otherErrorId : undefined}
              onChange={(event) => onOtherChange(event.target.value)}
            />
          </>
        )}
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {isOther && otherError && (
        <p id={otherErrorId} className="field-error">
          {otherError}
        </p>
      )}
    </div>
  );
}
