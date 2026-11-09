import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { FormAlert } from '../../../components/form/FormAlert';
import { SelectField } from '../../../components/form/SelectField';
import { TextAreaField } from '../../../components/form/TextAreaField';
import { TextField } from '../../../components/form/TextField';
import { Modal } from '../../../components/Modal';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { useFormErrors } from '../../auth/use-form-errors';
import { StatusBadge } from '../components/StatusBadge';
import { describeHistory } from '../task-history';
import { TASK_STATUSES } from '../task-status';
import type { ExcelSync, TaskDetail, TaskStatus, TaskUpdate } from '../task.types';
import { tasksApi } from '../tasks.api';
import {
  descriptionSchema,
  formatTaskDate,
  referenceSchema,
  taskNameSchema,
} from '../tasks.schemas';

const STATUS_LABELS = TASK_STATUSES.map((status) => status.label);
const labelToStatus = (label: string) => TASK_STATUSES.find((s) => s.label === label)?.value;
const statusToLabel = (status: TaskStatus) =>
  TASK_STATUSES.find((s) => s.value === status)?.label ?? '';

const CONFLICT_CODES = ['TASK_VERSION_CONFLICT', 'TASK_UPDATE_VERSION_CONFLICT'];

const editSchema = z.object({
  name: taskNameSchema,
  description: descriptionSchema,
  reference: referenceSchema,
  status: z.string().min(1, 'Choose a status'),
});

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; task: TaskDetail };

/** The change is saved; the Excel file follows in the background (status on Workbooks page). */
function syncMessage(sync: ExcelSync): string {
  return sync.status === 'queued' ? 'The Excel workbook is being updated in the background.' : '';
}

function Reference({ value }: { value: string | null }) {
  if (!value) {
    return <span className="muted">None</span>;
  }
  return /^https?:\/\//i.test(value) ? (
    <a href={value} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  ) : (
    <>{value}</>
  );
}

/** Task detail: details, dated updates, history, and the edit / delete actions. */
export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ variant: 'success' | 'error'; text: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    tasksApi.get(taskId).then(
      (task) => active && setState({ status: 'ready', task }),
      (error: unknown) => {
        if (!active) {
          return;
        }
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not-found' }
            : { status: 'error', message: errorMessage(error) },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [taskId, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  /** After a change: show the outcome and reload the task (new versions, history). */
  function afterChange(text: string) {
    setMessage({ variant: 'success', text });
    setMode('view');
    setEditingUpdateId(null);
    reload();
  }

  /** Version conflicts mean someone changed the task elsewhere: show the latest data. */
  function onConflict(error: unknown): boolean {
    if (error instanceof ApiError && error.code && CONFLICT_CODES.includes(error.code)) {
      setMessage({
        variant: 'error',
        text: 'This task was changed elsewhere. The latest version is shown; please try again.',
      });
      setMode('view');
      setEditingUpdateId(null);
      reload();
      return true;
    }
    return false;
  }

  if (state.status === 'loading') {
    return (
      <div className="app app--wide">
        <p className="muted" role="status">
          Loading task…
        </p>
      </div>
    );
  }
  if (state.status === 'not-found') {
    return (
      <div className="app app--wide">
        <div className="card empty-state" role="status">
          <h1>Task not found</h1>
          <p className="muted">It may have been deleted, or it belongs to another account.</p>
          <Link to="/tasks" className="button">
            Back to tasks
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="app app--wide">
        <FormAlert variant="error">
          {state.message}{' '}
          <button type="button" className="button button--subtle" onClick={reload}>
            Try again
          </button>
        </FormAlert>
      </div>
    );
  }

  const { task } = state;
  const latest = task.updates[0];

  return (
    <div className="app app--wide">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/tasks">← All tasks</Link>
      </nav>

      <header className="app-header app-header--bar task-header">
        <div>
          <p className="task-number task-number--large">#{task.taskNumber}</p>
          <h1>{task.name}</h1>
          <p className="muted">
            <StatusBadge status={task.status} /> · {task.workbook.name} ·{' '}
            {task.entryCount === 1 ? '1 entry' : `${task.entryCount} entries`}
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setMessage(null);
              setMode('edit');
            }}
            disabled={mode === 'edit'}
          >
            Edit
          </button>
          <button
            type="button"
            className="button"
            aria-expanded={showHistory}
            aria-controls="task-history"
            onClick={() => setShowHistory((value) => !value)}
          >
            {showHistory ? 'Hide history' : 'View history'}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              setMessage(null);
              setConfirmDelete(true);
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <main className="app-main">
        {message && <FormAlert variant={message.variant}>{message.text}</FormAlert>}

        {mode === 'edit' && latest ? (
          <EditTaskForm
            task={task}
            latest={latest}
            onCancel={() => setMode('view')}
            onSaved={afterChange}
            onConflict={onConflict}
          />
        ) : (
          <section className="card" aria-labelledby="details-heading">
            <h2 id="details-heading">Details</h2>
            <dl className="details task-details">
              <dt>Task number</dt>
              <dd>#{task.taskNumber}</dd>
              <dt>Task name</dt>
              <dd>{task.name}</dd>
              <dt>Task date</dt>
              <dd>{formatTaskDate(task.lastEntryDate)}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={task.status} />
              </dd>
              <dt>Description</dt>
              <dd className="preserve-lines">{latest?.description}</dd>
              <dt>Documentation reference</dt>
              <dd>
                <Reference value={latest?.reference ?? null} />
              </dd>
              <dt>Workbook</dt>
              <dd>
                <Link to="/workbooks">{task.workbook.name}</Link>
              </dd>
              <dt>Created</dt>
              <dd>{new Date(task.createdAt).toLocaleString()}</dd>
            </dl>
          </section>
        )}

        <section className="card" aria-labelledby="updates-heading">
          <h2 id="updates-heading">Task updates</h2>
          <p className="muted">One entry per day; each is a row in the Excel workbook.</p>
          <ol className="update-list">
            {task.updates.map((update) => (
              <li key={update.id} className="update-item">
                {editingUpdateId === update.id ? (
                  <EditUpdateForm
                    update={update}
                    onCancel={() => setEditingUpdateId(null)}
                    onSaved={afterChange}
                    onConflict={onConflict}
                  />
                ) : (
                  <>
                    <div className="update-item-header">
                      <strong>{formatTaskDate(update.entryDate)}</strong>
                      <StatusBadge status={update.status} />
                      <button
                        type="button"
                        className="button button--subtle"
                        aria-label={`Edit entry from ${formatTaskDate(update.entryDate)}`}
                        onClick={() => {
                          setMessage(null);
                          setEditingUpdateId(update.id);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                    <p className="preserve-lines">{update.description}</p>
                    {update.reference && (
                      <p className="muted">
                        Reference: <Reference value={update.reference} />
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>

        {showHistory && (
          <section className="card" id="task-history" aria-labelledby="history-heading">
            <h2 id="history-heading">History</h2>
            <ol className="history-list">
              {[...task.history].reverse().map((entry) => {
                const { title, details } = describeHistory(entry);
                return (
                  <li key={entry.id} className="history-item">
                    <time dateTime={entry.createdAt} className="muted">
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                    <strong>{title}</strong>
                    {details.length > 0 && (
                      <ul>
                        {details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </main>

      {confirmDelete && (
        <DeleteTaskDialog
          task={task}
          onCancel={() => setConfirmDelete(false)}
          onDeleted={(sync) =>
            void navigate('/tasks', {
              replace: true,
              state: {
                message:
                  `Task #${task.taskNumber} “${task.name}” was deleted. ${syncMessage(sync)}`.trim(),
              },
            })
          }
          onConflict={(error) => {
            setConfirmDelete(false);
            return onConflict(error);
          }}
        />
      )}
    </div>
  );
}

interface EditTaskFormProps {
  task: TaskDetail;
  latest: TaskUpdate;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onConflict: (error: unknown) => boolean;
}

/** "Edit": the task name and its latest dated entry. */
function EditTaskForm({ task, latest, onCancel, onSaved, onConflict }: EditTaskFormProps) {
  const [values, setValues] = useState({
    name: task.name,
    description: latest.description,
    reference: latest.reference ?? '',
    status: statusToLabel(latest.status),
  });
  const [saving, setSaving] = useState(false);
  const { fieldErrors, formError, validate, handleError, clearFieldError } = useFormErrors();

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    clearFieldError(field);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(editSchema, values);
    if (!parsed) {
      return;
    }
    const status = labelToStatus(parsed.status) ?? latest.status;
    const reference = parsed.reference === '' ? null : parsed.reference;
    const nameChanged = parsed.name !== task.name;
    const entryChanged =
      parsed.description !== latest.description ||
      reference !== latest.reference ||
      status !== latest.status;
    if (!nameChanged && !entryChanged) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      let sync: ExcelSync | undefined;
      if (nameChanged) {
        sync = (await tasksApi.rename(task, parsed.name)).excelSync;
      }
      if (entryChanged) {
        sync = (
          await tasksApi.editUpdate(latest, { description: parsed.description, reference, status })
        ).excelSync;
      }
      onSaved(`Task #${task.taskNumber} was updated. ${sync ? syncMessage(sync) : ''}`.trim());
    } catch (error) {
      if (!onConflict(error)) {
        handleError(error);
      }
      setSaving(false);
    }
  }

  return (
    <form
      className="card form form--grid"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-labelledby="edit-heading"
    >
      <h2 id="edit-heading" className="field--wide">
        Edit task
      </h2>
      {formError && <FormAlert variant="error">{formError}</FormAlert>}
      <div className="field--wide">
        <TextField
          label="Task Name"
          name="name"
          maxLength={200}
          value={values.name}
          onChange={update('name')}
          error={fieldErrors.name}
        />
      </div>
      <p className="field--wide muted edit-note">
        Description, reference and status belong to the latest entry (
        {formatTaskDate(latest.entryDate)}). Earlier entries can be edited under Task updates.
      </p>
      <div className="field--wide">
        <TextAreaField
          label="Task Description"
          name="description"
          rows={5}
          maxLength={5000}
          value={values.description}
          onChange={update('description')}
          error={fieldErrors.description}
        />
      </div>
      <TextField
        label="Documentation Link / Reference"
        name="reference"
        maxLength={2000}
        value={values.reference}
        onChange={update('reference')}
        error={fieldErrors.reference}
      />
      <SelectField
        label="Task Status"
        name="status"
        options={STATUS_LABELS}
        value={values.status}
        onChange={update('status')}
        error={fieldErrors.status}
      />
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface EditUpdateFormProps {
  update: TaskUpdate;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onConflict: (error: unknown) => boolean;
}

/** Edits one dated entry (its date is part of the history and stays fixed). */
function EditUpdateForm({ update, onCancel, onSaved, onConflict }: EditUpdateFormProps) {
  const [values, setValues] = useState({
    description: update.description,
    reference: update.reference ?? '',
    status: statusToLabel(update.status),
  });
  const [saving, setSaving] = useState(false);
  const { fieldErrors, formError, validate, handleError, clearFieldError } = useFormErrors();
  const entrySchema = editSchema.omit({ name: true });

  const change = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    clearFieldError(field);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(entrySchema, values);
    if (!parsed) {
      return;
    }
    setSaving(true);
    try {
      const result = await tasksApi.editUpdate(update, {
        description: parsed.description,
        reference: parsed.reference === '' ? null : parsed.reference,
        status: labelToStatus(parsed.status) ?? update.status,
      });
      onSaved(
        `The entry from ${formatTaskDate(update.entryDate)} was updated. ${syncMessage(result.excelSync)}`.trim(),
      );
    } catch (error) {
      if (!onConflict(error)) {
        handleError(error);
      }
      setSaving(false);
    }
  }

  return (
    <form
      className="form update-edit-form"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={`Edit entry from ${formatTaskDate(update.entryDate)}`}
    >
      <p>
        <strong>{formatTaskDate(update.entryDate)}</strong>
      </p>
      {formError && <FormAlert variant="error">{formError}</FormAlert>}
      <TextAreaField
        label="Description"
        name="description"
        rows={4}
        value={values.description}
        onChange={change('description')}
        error={fieldErrors.description}
      />
      <TextField
        label="Reference"
        name="reference"
        value={values.reference}
        onChange={change('reference')}
        error={fieldErrors.reference}
      />
      <SelectField
        label="Status"
        name="status"
        options={STATUS_LABELS}
        value={values.status}
        onChange={change('status')}
      />
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface DeleteTaskDialogProps {
  task: TaskDetail;
  onCancel: () => void;
  onDeleted: (sync: ExcelSync) => void;
  onConflict: (error: unknown) => boolean;
}

function DeleteTaskDialog({ task, onCancel, onDeleted, onConflict }: DeleteTaskDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onDeleted((await tasksApi.remove(task)).excelSync);
    } catch (err) {
      if (!onConflict(err)) {
        setError(errorMessage(err));
        setBusy(false);
      }
    }
  }

  return (
    <Modal
      labelledBy="delete-title"
      describedBy="delete-description"
      initialFocusRef={cancelRef}
      onClose={onCancel}
    >
      <h2 id="delete-title">Delete task #{task.taskNumber}?</h2>
      <div id="delete-description">
        <p>
          <strong>“{task.name}”</strong> and its{' '}
          {task.entryCount === 1 ? 'entry' : `${task.entryCount} entries`} will be removed from your
          task list and from the Excel workbook <strong>{task.workbook.name}</strong>.
        </p>
        <p className="muted">
          The task’s audit history is kept. The task number #{task.taskNumber} will not be reused.
        </p>
      </div>
      {error && <FormAlert variant="error">{error}</FormAlert>}
      <div className="form-actions dialog-actions">
        <button ref={cancelRef} type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger-solid"
          onClick={() => void confirm()}
          disabled={busy}
        >
          {busy ? 'Deleting…' : 'Delete task'}
        </button>
      </div>
    </Modal>
  );
}
