import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { useFormErrors } from '../../auth/use-form-errors';
import { useWorkbookList } from '../use-workbook-list';
import { workbooksApi } from '../workbooks.api';
import { DAILY_TASK_COLUMNS, workbookFormSchema } from '../workbooks.schemas';

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
  const [submitting, setSubmitting] = useState(false);
  const { fieldErrors, formError, validate, handleError, clearFieldError } = useFormErrors();

  if (state.status === 'loading') {
    return (
      <div className="app">
        <p className="muted" role="status">
          Loading…
        </p>
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
      const workbook = await workbooksApi.create(parsed.name, makeDefault);
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
            <div role="row" className="sheet-preview-row">
              {DAILY_TASK_COLUMNS.map((column, index) => (
                <span key={column} role="columnheader" className="sheet-preview-cell">
                  <span className="sheet-preview-letter">{String.fromCharCode(65 + index)}</span>
                  {column}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
