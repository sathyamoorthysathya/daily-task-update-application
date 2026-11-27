import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { useFormErrors } from '../../auth/use-form-errors';
import { useWorkbookList } from '../use-workbook-list';
import { workbooksApi } from '../workbooks.api';
import {
  columnLetter,
  DAILY_TASK_COLUMNS,
  EXTRA_COLUMN_NAME_MAX,
  extraColumnError,
  FIRST_EXTRA_COLUMN,
  MAX_EXTRA_COLUMNS,
  normaliseColumnName,
  workbookFormSchema,
} from '../workbooks.schemas';
import { CreateWorkbookSkeleton } from '../../../components/Skeletons';

interface LocationState {
  /** Where to continue after creating, e.g. "/tasks/new". */
  from?: string;
}

/**
 * "Create Excel Sheet": shown automatically to first-time users (no workbooks yet) and used
 * to add further workbooks.
 */
export function CreateWorkbookPage() {
  const navigate = useNavigate();
  const { from } = (useLocation().state ?? {}) as LocationState;
  const { state } = useWorkbookList();
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { fieldErrors, formError, validate, handleError, clearFieldError } = useFormErrors();
  // Server-side problems with one of the extra columns ("customColumns.2": "...").
  const columnServerError = Object.entries(fieldErrors).find(([field]) =>
    field.startsWith('customColumns'),
  )?.[1];

  if (state.status === 'loading') {
    return (
      <div className="app">
        <CreateWorkbookSkeleton />
      </div>
    );
  }

  const existing = state.status === 'ready' ? state.data.workbooks.length : 0;
  const firstTime = state.status === 'ready' && existing === 0;
  const atLimit = state.status === 'ready' && existing >= state.data.limit;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(workbookFormSchema, { name });
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    try {
      const workbook = await workbooksApi.create(parsed.name, makeDefault, extraColumns);
      const next =
        from?.startsWith('/') && !from.startsWith('//')
          ? from
          : firstTime
            ? '/dashboard'
            : '/workbooks';
      await navigate(next, { replace: true, state: { createdWorkbook: workbook.name } });
    } catch (error) {
      handleError(error);
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>{firstTime ? 'Create your Excel sheet' : 'Create a new workbook'}</h1>
        <p className="muted">
          {firstTime
            ? 'Your daily tasks are saved in an Excel workbook. Give it a name to get started.'
            : 'Keep separate workbooks, for example per project or per year.'}
        </p>
      </header>

      <main className="app-main">
        <section className="card" aria-label="New workbook">
          {state.status === 'error' && <FormAlert variant="error">{state.message}</FormAlert>}
          {atLimit ? (
            <FormAlert variant="info">
              You have reached the limit of {state.status === 'ready' ? state.data.limit : ''}{' '}
              workbooks. <Link to="/workbooks">Delete a workbook</Link> to create another.
            </FormAlert>
          ) : (
            <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
              {formError && <FormAlert variant="error">{formError}</FormAlert>}
              <TextField
                label="Workbook name"
                name="name"
                placeholder="e.g. Daily Tasks 2026"
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearFieldError('name');
                }}
                hint="Used as the Excel file name when you download it."
                error={fieldErrors.name}
              />
              <ExtraColumnsField
                columns={extraColumns}
                serverError={columnServerError}
                onChange={(columns) => {
                  setExtraColumns(columns);
                  for (const field of Object.keys(fieldErrors)) {
                    if (field.startsWith('customColumns')) {
                      clearFieldError(field);
                    }
                  }
                }}
              />
              {!firstTime && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    onChange={(event) => setMakeDefault(event.target.checked)}
                  />
                  Use as my default workbook for new tasks
                </label>
              )}
              <div className="form-actions">
                <button type="submit" className="button button--primary" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create Excel sheet'}
                </button>
                {!firstTime && (
                  <Link to="/workbooks" className="button">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="card" aria-labelledby="sheet-preview-heading">
          <h2 id="sheet-preview-heading">What you get</h2>
          <p className="muted">
            An Excel workbook with a <strong>Daily Tasks</strong> sheet: formatted headers, filters
            and a frozen header row, with these columns:
          </p>
          <div className="sheet-preview" role="table" aria-label="Daily Tasks columns">
            <div
              role="row"
              className="sheet-preview-row"
              style={{
                gridTemplateColumns: `repeat(${DAILY_TASK_COLUMNS.length + extraColumns.length}, minmax(110px, 1fr))`,
              }}
            >
              {DAILY_TASK_COLUMNS.map((column, index) => (
                <span key={column} role="columnheader" className="sheet-preview-cell">
                  <span className="sheet-preview-letter">{columnLetter(index + 1)}</span>
                  {column}
                </span>
              ))}
              {extraColumns.map((column, index) => (
                <span
                  key={column}
                  role="columnheader"
                  className="sheet-preview-cell sheet-preview-cell--extra"
                >
                  <span className="sheet-preview-letter">
                    {columnLetter(FIRST_EXTRA_COLUMN + index)}
                  </span>
                  {column}
                </span>
              ))}
            </div>
          </div>
          {extraColumns.length > 0 && (
            <p className="field-hint sheet-preview-note">
              Your extra columns are added after the built-in work-detail columns (Task Type,
              Project, Assigned By, Priority, Due Date, Start/End Time, Hours Worked, Remarks), from
              column {columnLetter(FIRST_EXTRA_COLUMN)}.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

interface ExtraColumnsFieldProps {
  columns: string[];
  serverError?: string;
  onChange: (columns: string[]) => void;
}

/** Optional extra columns for the sheet ("Client", "Ticket ID", ...), added one at a time. */
function ExtraColumnsField({ columns, serverError, onChange }: ExtraColumnsFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? serverError;
  const full = columns.length >= MAX_EXTRA_COLUMNS;

  function add() {
    const name = normaliseColumnName(draft);
    const problem = extraColumnError(name, columns);
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...columns, name]);
    setDraft('');
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter adds the column instead of submitting the whole form.
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="field extra-columns" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="field-label">
        Extra columns <span className="muted">(optional)</span>
      </span>
      <p className="field-hint">
        Add your own columns, e.g. Client or Ticket ID. They are added to the Excel sheet and you
        can fill them in on every task. Up to {MAX_EXTRA_COLUMNS}.
      </p>
      {columns.length > 0 && (
        <ul className="extra-column-list" aria-label="Extra columns">
          {columns.map((column) => (
            <li key={column} className="extra-column-chip">
              <span>{column}</span>
              <button
                type="button"
                className="extra-column-remove"
                aria-label={`Remove column ${column}`}
                onClick={() => {
                  onChange(columns.filter((other) => other !== column));
                  setError(null);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="extra-column-add">
        <input
          id={`${id}-input`}
          aria-label="New column name"
          placeholder={full ? 'Column limit reached' : 'e.g. Client'}
          maxLength={EXTRA_COLUMN_NAME_MAX}
          value={draft}
          disabled={full}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${id}-error` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="button" onClick={add} disabled={full}>
          Add column
        </button>
      </div>
      {shownError && (
        <p id={`${id}-error`} className="field-error">
          {shownError}
        </p>
      )}
    </div>
  );
}
