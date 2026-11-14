import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { FormAlert } from '../../../components/form/FormAlert';
import { SelectField } from '../../../components/form/SelectField';
import { TextAreaField } from '../../../components/form/TextAreaField';
import { TextField } from '../../../components/form/TextField';
import { TimeField } from '../../../components/form/TimeField';
import { PencilIcon } from '../../../components/icons';
import { Modal } from '../../../components/Modal';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { useFormErrors } from '../../auth/use-form-errors';
import { StatusBadge } from '../components/StatusBadge';
import { describeHistory } from '../task-history';
import { priorityLabel, TASK_PRIORITIES, TASK_STATUSES } from '../task-status';
import type { ExcelSync, TaskDetail, TaskDetails, TaskStatus, TaskUpdate } from '../task.types';
import { tasksApi } from '../tasks.api';
import {
  checkWorkingHours,
  descriptionSchema,
  formatMinutes,
  formatTaskDate,
  formatClock,
  referenceSchema,
  taskDetailFields,
  taskNameSchema,
  todayLocal,
  toTaskDetails,
  toWorkDetails,
  workDetailFields,
} from '../tasks.schemas';

const STATUS_LABELS = TASK_STATUSES.map((status) => status.label);
const labelToStatus = (label: string) => TASK_STATUSES.find((s) => s.label === label)?.value;
const statusToLabel = (status: TaskStatus) =>
  TASK_STATUSES.find((s) => s.value === status)?.label ?? '';
const PRIORITY_LABELS = TASK_PRIORITIES.map((priority) => priority.label);

const CONFLICT_CODES = ['TASK_VERSION_CONFLICT', 'TASK_UPDATE_VERSION_CONFLICT'];

const entryFields = {
  description: descriptionSchema,
  reference: referenceSchema,
  status: z.string().min(1, 'Choose a status'),
  ...workDetailFields,
};

/** One dated entry. */
const entrySchema = z.object(entryFields).superRefine(checkWorkingHours);

/** The task itself: its name and details. */
const editSchema = z.object({ name: taskNameSchema, ...taskDetailFields });

const NONE = <span className="muted">—</span>;

/** "Saturday" for a calendar date "YYYY-MM-DD". */
const weekday = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    timeZone: 'UTC',
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
      <div className="app app--task">
        <p className="muted" role="status">
          Loading task…
        </p>
      </div>
    );
  }
  if (state.status === 'not-found') {
    return (
      <div className="app app--task">
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
      <div className="app app--task">
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
  const minutesRecorded = task.updates.reduce((sum, u) => sum + (u.minutesWorked ?? 0), 0);
  const overdue =
    task.dueDate !== null && task.status !== 'COMPLETED' && task.dueDate < todayLocal();

  return (
    <div className="app app--task">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/tasks">Tasks</Link>
        <span aria-hidden="true">/</span>
        <span className="task-number">#{task.taskNumber}</span>
      </nav>

      <header className="app-header app-header--bar task-header">
        <div className="task-header-text">
          <h1>{task.name}</h1>
          <p className="task-meta">
            <StatusBadge status={task.status} />
            {task.priority && (
              <span className={`priority priority--${task.priority.toLowerCase()}`}>
                {priorityLabel(task.priority)} priority
              </span>
            )}
            <span>
              {task.workbook.name} ·{' '}
              {task.entryCount === 1 ? '1 entry' : `${task.entryCount} entries`}
            </span>
          </p>
        </div>
        <div className="header-actions">
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

      <div className="task-layout">
        <main className="task-main">
          {message && <FormAlert variant={message.variant}>{message.text}</FormAlert>}

          <section className="card" aria-labelledby="updates-heading">
            <div className="card-header">
              <div>
                <h2 id="updates-heading">Daily entries</h2>
                <p className="muted">
                  One entry per day, newest first. Each one is a row in the Excel workbook.
                </p>
              </div>
              <span className="entry-count">
                {task.entryCount === 1 ? '1 entry' : `${task.entryCount} entries`}
              </span>
            </div>
            <ol className="update-list">
              {task.updates.map((update, index) => (
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
                        <div className="update-date">
                          <span className="update-weekday">{weekday(update.entryDate)}</span>
                          <strong>{formatTaskDate(update.entryDate)}</strong>
                        </div>
                        <StatusBadge status={update.status} />
                        {index === 0 && task.updates.length > 1 && (
                          <span className="update-latest">Latest</span>
                        )}
                        <button
                          type="button"
                          className="button update-edit"
                          aria-label={`Edit entry from ${formatTaskDate(update.entryDate)}`}
                          onClick={() => {
                            setMessage(null);
                            setEditingUpdateId(update.id);
                          }}
                        >
                          <PencilIcon /> Edit
                        </button>
                      </div>
                      {/* Every field of the entry, labelled; the Edit button changes all of them. */}
                      <dl className="entry-facts">
                        <div>
                          <dt>Start time</dt>
                          <dd>{update.startTime ? formatClock(update.startTime) : NONE}</dd>
                        </div>
                        <div>
                          <dt>End time</dt>
                          <dd>{update.endTime ? formatClock(update.endTime) : NONE}</dd>
                        </div>
                        <div>
                          <dt>Hours worked</dt>
                          <dd>
                            {update.minutesWorked !== null
                              ? formatMinutes(update.minutesWorked)
                              : NONE}
                          </dd>
                        </div>
                        <div className="entry-fact--wide">
                          <dt>Work done</dt>
                          <dd className="preserve-lines">{update.description}</dd>
                        </div>
                        <div className="entry-fact--wide">
                          <dt>Remarks / blockers</dt>
                          <dd className="preserve-lines">{update.remarks ?? NONE}</dd>
                        </div>
                        <div className="entry-fact--wide">
                          <dt>Documentation link / reference</dt>
                          <dd>
                            {update.reference ? <Reference value={update.reference} /> : NONE}
                          </dd>
                        </div>
                      </dl>
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

        <aside className="task-side">
          <section className="card" aria-labelledby="details-heading">
            <div className="card-header task-side-header">
              <h2 id="details-heading">Details</h2>
              {mode === 'view' && (
                <button
                  type="button"
                  className="button task-edit"
                  onClick={() => {
                    setMessage(null);
                    setMode('edit');
                  }}
                >
                  <PencilIcon /> Edit
                </button>
              )}
            </div>
            {mode === 'edit' ? (
              <EditTaskForm
                task={task}
                onCancel={() => setMode('view')}
                onSaved={afterChange}
                onConflict={onConflict}
              />
            ) : (
              <dl className="task-facts">
                <div>
                  <dt>Project / module</dt>
                  <dd>{task.project ?? NONE}</dd>
                </div>
                <div>
                  <dt>Assigned by</dt>
                  <dd>{task.assignedBy ?? NONE}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{task.priority ? priorityLabel(task.priority) : NONE}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>
                    {task.dueDate ? formatTaskDate(task.dueDate) : NONE}
                    {overdue && <span className="task-overdue">Overdue</span>}
                  </dd>
                </div>
                <div>
                  <dt>Time recorded</dt>
                  <dd>{minutesRecorded > 0 ? formatMinutes(minutesRecorded) : NONE}</dd>
                </div>
                <div>
                  <dt>Last entry</dt>
                  <dd>{formatTaskDate(task.lastEntryDate)}</dd>
                </div>
                <div>
                  <dt>Workbook</dt>
                  <dd>
                    <Link to="/workbooks">{task.workbook.name}</Link>
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {new Date(task.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
              </dl>
            )}
          </section>
        </aside>
      </div>

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
  onCancel: () => void;
  onSaved: (message: string) => void;
  onConflict: (error: unknown) => boolean;
}

/**
 * Edits what the Details card shows: the task name, project, who assigned it, priority and
 * due date. Daily entries have their own Edit buttons.
 */
function EditTaskForm({ task, onCancel, onSaved, onConflict }: EditTaskFormProps) {
  const [values, setValues] = useState({
    name: task.name,
    project: task.project ?? '',
    assignedBy: task.assignedBy ?? '',
    priority: task.priority ?? '',
    dueDate: task.dueDate ?? '',
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
    // Only the task details that changed are sent.
    const details = toTaskDetails(parsed);
    const changedDetails: Partial<TaskDetails> = {};
    for (const field of ['project', 'assignedBy', 'priority', 'dueDate'] as const) {
      if (details[field] !== task[field]) {
        Object.assign(changedDetails, { [field]: details[field] });
      }
    }
    if (parsed.name === task.name && Object.keys(changedDetails).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      const { excelSync } = await tasksApi.rename(task, parsed.name, changedDetails);
      onSaved(`Task #${task.taskNumber} was updated. ${syncMessage(excelSync)}`.trim());
    } catch (error) {
      if (!onConflict(error)) {
        handleError(error);
      }
      setSaving(false);
    }
  }

  return (
    <form
      className="form task-details-form"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label="Edit task"
    >
      {formError && <FormAlert variant="error">{formError}</FormAlert>}
      <TextField
        label="Task Name"
        name="name"
        maxLength={200}
        value={values.name}
        onChange={update('name')}
        error={fieldErrors.name}
      />
      <TextField
        label="Project / Module"
        name="project"
        maxLength={100}
        value={values.project}
        onChange={update('project')}
        error={fieldErrors.project}
      />
      <TextField
        label="Assigned By"
        name="assignedBy"
        maxLength={100}
        value={values.assignedBy}
        onChange={update('assignedBy')}
        error={fieldErrors.assignedBy}
      />
      <SelectField
        label="Priority"
        name="priority"
        options={PRIORITY_LABELS}
        placeholder="Not set"
        value={TASK_PRIORITIES.find((p) => p.value === values.priority)?.label ?? ''}
        onChange={(event) => {
          const priority = TASK_PRIORITIES.find((p) => p.label === event.target.value);
          setValues((current) => ({ ...current, priority: priority?.value ?? '' }));
          clearFieldError('priority');
        }}
        error={fieldErrors.priority}
      />
      <TextField
        label="Due Date"
        type="date"
        name="dueDate"
        value={values.dueDate}
        onChange={update('dueDate')}
        error={fieldErrors.dueDate}
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
    startTime: update.startTime ?? '',
    endTime: update.endTime ?? '',
    remarks: update.remarks ?? '',
  });
  const [saving, setSaving] = useState(false);
  const { fieldErrors, formError, validate, handleError, clearFieldError } = useFormErrors();

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
        ...toWorkDetails(parsed),
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
      <div className="form-row-pair">
        <TimeField
          label="Start time"
          name="startTime"
          value={values.startTime}
          onChange={change('startTime')}
          error={fieldErrors.startTime}
        />
        <TimeField
          label="End time"
          name="endTime"
          value={values.endTime}
          onChange={change('endTime')}
          error={fieldErrors.endTime}
        />
      </div>
      <TextAreaField
        label="Remarks"
        name="remarks"
        rows={2}
        maxLength={2000}
        value={values.remarks}
        onChange={change('remarks')}
        error={fieldErrors.remarks}
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
