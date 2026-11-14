import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { SelectField } from '../../../components/form/SelectField';
import { TextAreaField } from '../../../components/form/TextAreaField';
import { TextField } from '../../../components/form/TextField';
import { TimeField } from '../../../components/form/TimeField';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { useFormErrors } from '../../auth/use-form-errors';
import { useWorkbookList } from '../../workbooks/use-workbook-list';
import { DuplicateTaskDialog, type DuplicateChoice } from '../components/DuplicateTaskDialog';
import { RecentUpdates } from '../components/RecentUpdates';
import { StatusBadge } from '../components/StatusBadge';
import { TASK_PRIORITIES, TASK_STATUSES } from '../task-status';
import { ExcelSyncNotice } from '../../workbooks/components/ExcelSyncNotice';
import type {
  ExcelSync,
  RecentTaskUpdate,
  SaveTaskResult,
  TaskMatch,
  TaskPriority,
  TaskStatus,
} from '../task.types';
import { tasksApi } from '../tasks.api';
import {
  formatMinutes,
  formatTaskDate,
  minutesBetween,
  type ParsedTaskForm,
  taskFormSchema,
  todayLocal,
  toCreateTaskInput,
} from '../tasks.schemas';

type FormFields = {
  name: string;
  entryDate: string;
  project: string;
  assignedBy: string;
  priority: '' | TaskPriority;
  dueDate: string;
  description: string;
  startTime: string;
  endTime: string;
  remarks: string;
  reference: string;
  status: TaskStatus;
};

const emptyFields = (entryDate = todayLocal()): FormFields => ({
  name: '',
  entryDate,
  project: '',
  assignedBy: '',
  priority: '',
  dueDate: '',
  description: '',
  startTime: '',
  endTime: '',
  remarks: '',
  reference: '',
  status: 'TO_DO',
});

const STATUS_LABELS = TASK_STATUSES.map((status) => status.label);
const PRIORITY_LABELS = TASK_PRIORITIES.map((priority) => priority.label);

function isTaskMatch(value: unknown): value is TaskMatch {
  return typeof value === 'object' && value !== null && 'task' in value && 'targetUpdate' in value;
}

export function NewTaskPage() {
  const { state, reload: reloadWorkbooks } = useWorkbookList();
  const [chosenWorkbookId, setChosenWorkbookId] = useState<string | null>(null);
  const [values, setValues] = useState<FormFields>(() => emptyFields());
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<{ message: string; sync: ExcelSync; key: number } | null>(
    null,
  );
  const [nameMatch, setNameMatch] = useState<TaskMatch | null>(null);
  const [duplicate, setDuplicate] = useState<{ match: TaskMatch; input: ParsedTaskForm } | null>(
    null,
  );
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTaskUpdate[] | null>(null);
  const [recentVersion, setRecentVersion] = useState(0);
  const lookupRequest = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { fieldErrors, formError, validate, handleError, clearFieldError, reset } = useFormErrors();

  const list = state.status === 'ready' ? state.data : null;
  const workbooks = list?.workbooks ?? [];
  // Default workbook when there is one; the only workbook otherwise; else the user must choose.
  const preselected = list?.defaultWorkbookId ?? (workbooks.length === 1 ? workbooks[0]!.id : '');
  const workbookId = chosenWorkbookId ?? preselected;
  const selected = workbooks.find((workbook) => workbook.id === workbookId);

  useEffect(() => {
    if (!workbookId) {
      return;
    }
    let active = true;
    tasksApi.recent(workbookId).then(
      (result) => active && setRecent(result.updates),
      () => active && setRecent([]),
    );
    return () => {
      active = false;
    };
  }, [workbookId, recentVersion]);

  const closeDialog = useCallback(() => {
    setDuplicate(null);
    setDialogError(null);
  }, []);

  if (list && workbooks.length === 0) {
    return <Navigate to="/workbooks/new" replace state={{ from: '/tasks/new' }} />;
  }

  function update(field: keyof FormFields) {
    return (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      clearFieldError(field);
      if (field === 'name') {
        setNameMatch(null);
      }
    };
  }

  /** Early, non-blocking hint that the name is already used in this workbook. */
  async function checkName() {
    const name = values.name.trim();
    const request = ++lookupRequest.current;
    if (!name || !workbookId) {
      setNameMatch(null);
      return;
    }
    try {
      const { match } = await tasksApi.lookup(workbookId, name, values.entryDate);
      if (request === lookupRequest.current) {
        setNameMatch(match);
      }
    } catch {
      setNameMatch(null);
    }
  }

  function onSaved(message: string, result: SaveTaskResult) {
    setSaved((previous) => ({
      message,
      sync: result.excelSync,
      key: (previous?.key ?? 0) + 1,
    }));
    setValues((current) => emptyFields(current.entryDate));
    setNameMatch(null);
    reset();
    setRecentVersion((n) => n + 1);
    reloadWorkbooks();
    nameInputRef.current?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    const parsed = validate(taskFormSchema, { ...values, workbookId });
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await tasksApi.create(toCreateTaskInput(parsed));
      onSaved(
        `Task #${result.task.taskNumber} “${result.task.name}” was added to ${selected?.name ?? 'the workbook'}.`,
        result,
      );
    } catch (error) {
      const details = error instanceof ApiError ? error.response?.details : undefined;
      if (
        error instanceof ApiError &&
        error.code === 'TASK_ALREADY_EXISTS' &&
        isTaskMatch(details)
      ) {
        setDuplicate({ match: details, input: parsed });
      } else {
        handleError(error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveDuplicate(choice: DuplicateChoice) {
    if (!duplicate) {
      return;
    }
    const { match, input } = duplicate;
    const entry = toCreateTaskInput(input);
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result =
        choice === 'update'
          ? await tasksApi.editUpdate(match.targetUpdate, {
              description: entry.description,
              reference: entry.reference,
              status: entry.status,
              startTime: entry.startTime,
              endTime: entry.endTime,
              remarks: entry.remarks,
            })
          : await tasksApi.addUpdate(match.task.id, {
              entryDate: entry.entryDate,
              description: entry.description,
              reference: entry.reference,
              status: entry.status,
              startTime: entry.startTime,
              endTime: entry.endTime,
              remarks: entry.remarks,
            });
      setDuplicate(null);
      onSaved(
        choice === 'update'
          ? `Task #${result.task.taskNumber}: the entry from ${formatTaskDate(result.update.entryDate)} was updated.`
          : `Task #${result.task.taskNumber}: a new entry for ${formatTaskDate(result.update.entryDate)} was added.`,
        result,
      );
    } catch (error) {
      setDialogError(errorMessage(error));
      // Someone else changed the task meanwhile: show its current state.
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await tasksApi
          .lookup(input.workbookId, input.name, input.entryDate)
          .catch(() => null);
        if (refreshed?.match) {
          setDuplicate({ match: refreshed.match, input });
        }
      }
    } finally {
      setDialogBusy(false);
    }
  }

  const hoursWorked = minutesBetween(values.startTime, values.endTime);

  return (
    <div className="app app--wide">
      <header className="app-header">
        <h1>New task</h1>
        <p className="muted">
          Record what you worked on today. It is saved, added to your Excel workbook and shown in
          your work report.
        </p>
      </header>

      {state.status === 'loading' && (
        <p className="muted" role="status">
          Loading…
        </p>
      )}
      {state.status === 'error' && <FormAlert variant="error">{state.message}</FormAlert>}

      {list && (
        <main className="app-main">
          {saved && (
            <FormAlert variant="success">
              {saved.message}{' '}
              {saved.sync.status === 'queued' ? (
                // Saved in the database; follow the background Excel update.
                <ExcelSyncNotice key={saved.key} workbookId={saved.sync.workbookId} />
              ) : (
                'Nothing changed.'
              )}
            </FormAlert>
          )}

          <form
            className="card form form--grid task-form"
            onSubmit={(event) => void onSubmit(event)}
            noValidate
            aria-label="New task"
          >
            {formError && <FormAlert variant="error">{formError}</FormAlert>}

            <div className="field field--wide">
              {workbooks.length > 1 ? (
                <WorkbookSelect
                  value={workbookId}
                  workbooks={workbooks}
                  defaultId={list.defaultWorkbookId}
                  error={fieldErrors.workbookId}
                  onChange={(id) => {
                    setChosenWorkbookId(id);
                    setNameMatch(null);
                    clearFieldError('workbookId');
                  }}
                />
              ) : (
                <p className="workbook-single">
                  Workbook: <strong>{selected?.name}</strong>
                </p>
              )}
            </div>

            <div className="form-section field--wide">
              <h2>Task</h2>
              <p className="muted">What the task is and who gave it to you.</p>
            </div>

            <TextField
              label="Task Number"
              name="taskNumber"
              value={selected ? `#${selected.nextTaskNumber}` : '—'}
              readOnly
              hint="Assigned automatically when you save."
            />
            <TextField
              label="Task Date"
              type="date"
              name="entryDate"
              value={values.entryDate}
              onChange={update('entryDate')}
              error={fieldErrors.entryDate}
            />
            <div className="field--wide">
              <TextField
                ref={nameInputRef}
                label="Task Name"
                name="name"
                maxLength={200}
                autoComplete="off"
                value={values.name}
                onChange={update('name')}
                onBlur={() => void checkName()}
                error={fieldErrors.name}
              />
              {nameMatch && (
                <p className="field-hint name-match" role="status">
                  A task with this name already exists in this workbook (#
                  {nameMatch.task.taskNumber}, latest {formatTaskDate(nameMatch.task.lastEntryDate)}
                  , <StatusBadge status={nameMatch.task.status} />
                  ). You will be asked whether to update it or add a new daily entry; the task
                  details below stay as they are and can be changed on the task’s page.
                </p>
              )}
            </div>
            <TextField
              label="Project / Module"
              name="project"
              maxLength={100}
              placeholder="e.g. Billing module"
              value={values.project}
              onChange={update('project')}
              hint="Optional."
              error={fieldErrors.project}
            />
            <TextField
              label="Assigned By"
              name="assignedBy"
              maxLength={100}
              placeholder="Manager or team lead"
              value={values.assignedBy}
              onChange={update('assignedBy')}
              hint="Optional. Who gave you this task."
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
              hint="Optional. The deadline you were given."
              error={fieldErrors.dueDate}
            />

            <div className="form-section field--wide">
              <h2>Work done</h2>
              <p className="muted">What you did on this date, how long it took and any blockers.</p>
            </div>

            <div className="field--wide">
              <TextAreaField
                label="Task Description"
                name="description"
                rows={5}
                maxLength={5000}
                placeholder="What did you work on?"
                value={values.description}
                onChange={update('description')}
                error={fieldErrors.description}
              />
            </div>
            <TimeField
              label="Start Time"
              name="startTime"
              value={values.startTime}
              onChange={update('startTime')}
              hint="Optional."
              error={fieldErrors.startTime}
            />
            <TimeField
              label="End Time"
              name="endTime"
              value={values.endTime}
              onChange={update('endTime')}
              hint={
                hoursWorked === null
                  ? 'Optional. Hours worked are calculated for you.'
                  : `Hours worked: ${formatMinutes(hoursWorked)}`
              }
              error={fieldErrors.endTime}
            />
            <div className="field--wide">
              <TextAreaField
                label="Remarks / Blockers"
                name="remarks"
                rows={2}
                maxLength={2000}
                placeholder="Anything that slowed you down, or a note for your manager"
                value={values.remarks}
                onChange={update('remarks')}
                hint="Optional."
                error={fieldErrors.remarks}
              />
            </div>
            <TextField
              label="Documentation Link / Reference"
              name="reference"
              maxLength={2000}
              placeholder="https://… or a ticket number"
              value={values.reference}
              onChange={update('reference')}
              hint="Optional. Links must start with http:// or https://."
              error={fieldErrors.reference}
            />
            <SelectField
              label="Task Status"
              name="status"
              options={STATUS_LABELS}
              value={TASK_STATUSES.find((status) => status.value === values.status)?.label ?? ''}
              onChange={(event) => {
                const status = TASK_STATUSES.find((entry) => entry.label === event.target.value);
                if (status) {
                  setValues((current) => ({ ...current, status: status.value }));
                }
              }}
              error={fieldErrors.status}
            />

            <div className="form-actions">
              <button type="submit" className="button button--primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save task'}
              </button>
              <Link to="/workbooks/new" state={{ from: '/tasks/new' }} className="button">
                New workbook
              </Link>
            </div>
          </form>

          {workbookId && <RecentUpdates updates={recent} workbookName={selected?.name} />}
        </main>
      )}

      {duplicate && (
        <DuplicateTaskDialog
          match={duplicate.match}
          entryDate={duplicate.input.entryDate}
          busy={dialogBusy}
          error={dialogError}
          onChoose={(choice) => void resolveDuplicate(choice)}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}

interface WorkbookSelectProps {
  value: string;
  workbooks: { id: string; name: string; taskCount: number }[];
  defaultId: string | null;
  error?: string;
  onChange: (id: string) => void;
}

/** Workbook picker; without a default workbook the user has to choose explicitly. */
function WorkbookSelect({ value, workbooks, defaultId, error, onChange }: WorkbookSelectProps) {
  return (
    <div className="field">
      <label htmlFor="task-workbook">Workbook</label>
      <select
        id="task-workbook"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'task-workbook-error' : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {!defaultId && <option value="">Choose a workbook…</option>}
        {workbooks.map((workbook) => (
          <option key={workbook.id} value={workbook.id}>
            {workbook.name}
            {workbook.id === defaultId ? ' (default)' : ''} · {workbook.taskCount}{' '}
            {workbook.taskCount === 1 ? 'task' : 'tasks'}
          </option>
        ))}
      </select>
      {error ? (
        <p id="task-workbook-error" className="field-error">
          {error}
        </p>
      ) : (
        !defaultId && (
          <p className="field-hint">
            You have no default workbook, so choose where this task goes.
          </p>
        )
      )}
    </div>
  );
}
