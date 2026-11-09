import { type FormEvent, useState } from 'react';
import { FormAlert } from '../../../components/form/FormAlert';
import { TextField } from '../../../components/form/TextField';
import { ApiError, errorMessage } from '../../../lib/api/api-error';
import { useFormErrors } from '../../auth/use-form-errors';
import { formatDate } from '../../profile/profile.schemas';
import type { Workbook, WorkbookList, WorkbookSyncState } from '../workbook.types';
import { workbooksApi } from '../workbooks.api';
import { formatFileSize, taskCountLabel, workbookFormSchema } from '../workbooks.schemas';

interface Props {
  workbook: Workbook;
  /** Called after a change; with the new list when the API returned one, else reload. */
  onChanged: (list?: WorkbookList) => void;
}

type Mode = 'view' | 'rename' | 'delete';

const SYNC_BADGES: Record<
  Exclude<WorkbookSyncState, 'synced'>,
  { label: string; className: string }
> = {
  pending: { label: 'Updating Excel…', className: 'status-badge--checking' },
  retrying: { label: 'Excel update retrying', className: 'status-badge--checking' },
  failed: { label: 'Excel update failed', className: 'status-badge--down' },
};

const CONFLICT_MESSAGE =
  'This workbook was changed in another window. The list has been refreshed.';

export function WorkbookCard({ workbook, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState(workbook.name);
  const [confirmName, setConfirmName] = useState('');
  const { fieldErrors, formError, validate, handleError, reset, clearFieldError } = useFormErrors();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    reset();
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'WORKBOOK_VERSION_CONFLICT') {
        setMessage(CONFLICT_MESSAGE);
        setMode('view');
        onChanged();
      } else if (mode === 'rename') {
        handleError(error);
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  function onRename(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(workbookFormSchema, { name: newName });
    if (!parsed) {
      return;
    }
    void run(async () => {
      await workbooksApi.rename(workbook, parsed.name);
      setMode('view');
      onChanged();
    });
  }

  function onDelete(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await workbooksApi.remove(workbook);
      onChanged();
    });
  }

  return (
    <li className="card workbook-card" aria-label={workbook.name}>
      <div className="workbook-card-main">
        <div className="workbook-icon" aria-hidden="true">
          XLSX
        </div>
        <div className="workbook-info">
          <h2 className="workbook-name">
            {workbook.name}{' '}
            {workbook.isDefault && <span className="status-badge status-badge--up">Default</span>}
          </h2>
          <p className="muted workbook-meta">
            Created {formatDate(workbook.createdAt)} · {taskCountLabel(workbook.taskCount)} ·{' '}
            {formatFileSize(workbook.sizeBytes)}
          </p>
          {workbook.syncStatus !== 'synced' && (
            <div className="workbook-sync">
              <p>
                <span className={`status-badge ${SYNC_BADGES[workbook.syncStatus].className}`}>
                  {SYNC_BADGES[workbook.syncStatus].label}
                </span>{' '}
                {workbook.syncStatus !== 'pending' && (
                  <button
                    type="button"
                    className="button button--subtle"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await workbooksApi.syncNow(workbook.id);
                        onChanged();
                      })
                    }
                  >
                    Resync now
                  </button>
                )}
              </p>
              {workbook.syncError && (
                <p className="muted workbook-sync-error">
                  Last error: {workbook.syncError} Your tasks are saved; only the Excel file is
                  behind.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {mode === 'view' && (
        <div className="form-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void run(() => workbooksApi.download(workbook))}
          >
            Download
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setNewName(workbook.name);
              reset();
              setMode('rename');
            }}
          >
            Rename
          </button>
          {!workbook.isDefault && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => onChanged(await workbooksApi.setDefault(workbook.id)))
              }
            >
              Set as default
            </button>
          )}
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() => {
              setConfirmName('');
              setMode('delete');
            }}
          >
            Delete
          </button>
        </div>
      )}

      {mode === 'rename' && (
        <form className="form workbook-inline-form" onSubmit={onRename} noValidate>
          {formError && <FormAlert variant="error">{formError}</FormAlert>}
          <TextField
            label="New name"
            name="name"
            autoFocus
            maxLength={100}
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
              clearFieldError('name');
            }}
            error={fieldErrors.name}
          />
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode('view')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <form className="form workbook-inline-form danger-zone" onSubmit={onDelete} noValidate>
          <p>
            <strong>Delete “{workbook.name}”?</strong> The Excel file and its{' '}
            {taskCountLabel(workbook.taskCount)} will be permanently deleted. Download it first if
            you want to keep a copy.
          </p>
          <TextField
            label={`Type “${workbook.name}” to confirm`}
            name="confirmName"
            autoFocus
            autoComplete="off"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <div className="form-actions">
            <button
              type="submit"
              className="button button--danger-solid"
              disabled={busy || confirmName.trim() !== workbook.name}
            >
              {busy ? 'Deleting…' : 'Delete workbook'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode('view')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && <FormAlert variant="error">{message}</FormAlert>}
    </li>
  );
}
