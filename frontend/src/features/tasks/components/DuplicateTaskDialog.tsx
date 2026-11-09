import { useRef } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { Modal } from '../../../components/Modal';
import { formatTaskDate } from '../tasks.schemas';
import type { TaskMatch } from '../task.types';
import { StatusBadge } from './StatusBadge';

export type DuplicateChoice = 'update' | 'new-entry';

interface Props {
  match: TaskMatch;
  /** Date chosen in the form (for a new daily entry). */
  entryDate: string;
  busy: boolean;
  error: string | null;
  onChoose: (choice: DuplicateChoice) => void;
  onCancel: () => void;
}

/** Asks what to do when the entered task name already exists. Nothing is saved until a choice. */
export function DuplicateTaskDialog({ match, entryDate, busy, error, onChoose, onCancel }: Props) {
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const { task, targetUpdate, hasUpdateOnDate } = match;

  return (
    <Modal
      labelledBy="duplicate-title"
      describedBy="duplicate-summary"
      initialFocusRef={firstActionRef}
      onClose={onCancel}
    >
      <h2 id="duplicate-title">This task already exists. What would you like to do?</h2>

      <div id="duplicate-summary" className="duplicate-summary">
        <p className="duplicate-task">
          <span className="task-number">#{task.taskNumber}</span> <strong>{task.name}</strong>
        </p>
        <p className="muted">
          In {match.workbookName} ·{' '}
          {task.entryCount === 1 ? '1 entry' : `${task.entryCount} entries`} · latest{' '}
          {formatTaskDate(task.lastEntryDate)} <StatusBadge status={task.status} />
        </p>
      </div>

      {error && <FormAlert variant="error">{error}</FormAlert>}

      <div className="dialog-options">
        <button
          ref={firstActionRef}
          type="button"
          className="dialog-option"
          onClick={() => onChoose('update')}
          disabled={busy}
        >
          <span className="dialog-option-title">Update Existing Task</span>
          <span className="dialog-option-text">
            Replace the status, description and reference of the entry from{' '}
            {formatTaskDate(targetUpdate.entryDate)} with what you entered. The previous details are
            kept in the task history.
          </span>
        </button>

        <button
          type="button"
          className="dialog-option"
          onClick={() => onChoose('new-entry')}
          disabled={busy || hasUpdateOnDate}
          aria-describedby={hasUpdateOnDate ? 'new-entry-unavailable' : undefined}
        >
          <span className="dialog-option-title">Create New Daily Task Entry</span>
          <span className="dialog-option-text">
            Add a new entry for {formatTaskDate(entryDate)} linked to task #{task.taskNumber}.
            Earlier entries stay unchanged.
          </span>
          {hasUpdateOnDate && (
            <span id="new-entry-unavailable" className="dialog-option-note">
              This task already has an entry for {formatTaskDate(entryDate)}. Update it instead.
            </span>
          )}
        </button>
      </div>

      <div className="form-actions dialog-actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
