import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { FormAlert } from '../../../components/form/FormAlert';
import { WorkbookCard } from '../components/WorkbookCard';
import { useWorkbookList } from '../use-workbook-list';

/** How often the list refreshes while an Excel file is being updated in the background. */
export const SYNC_REFRESH_MS = 3000;

export function WorkbooksPage() {
  const { state, reload, replace } = useWorkbookList();
  const created = (useLocation().state as { createdWorkbook?: string } | null)?.createdWorkbook;

  // Follow background Excel updates until every workbook is synced (or needs a manual resync).
  const syncing =
    state.status === 'ready' &&
    state.data.workbooks.some((w) => w.syncStatus === 'pending' || w.syncStatus === 'retrying');
  useEffect(() => {
    if (!syncing) {
      return;
    }
    const timer = setTimeout(reload, SYNC_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [syncing, state, reload]);

  if (state.status === 'ready' && state.data.workbooks.length === 0) {
    return <Navigate to="/workbooks/new" replace />;
  }

  const atLimit = state.status === 'ready' && state.data.workbooks.length >= state.data.limit;

  return (
    <div className="app app--wide">
      <header className="app-header app-header--bar">
        <div>
          <h1>Workbooks</h1>
          <p className="muted">
            Your Excel workbooks. New tasks go to the default workbook unless you choose another.
          </p>
        </div>
        {state.status === 'ready' &&
          (atLimit ? (
            <span className="muted">Limit of {state.data.limit} workbooks reached</span>
          ) : (
            <Link to="/workbooks/new" className="button button--primary">
              New workbook
            </Link>
          ))}
      </header>

      {created && <FormAlert variant="success">Workbook “{created}” created.</FormAlert>}

      {state.status === 'loading' && (
        <p className="muted" role="status">
          Loading workbooks…
        </p>
      )}
      {state.status === 'error' && (
        <FormAlert variant="error">
          {state.message}{' '}
          <button type="button" className="button button--subtle" onClick={reload}>
            Try again
          </button>
        </FormAlert>
      )}
      {state.status === 'ready' && (
        <ul className="workbook-list" aria-label="Workbooks">
          {state.data.workbooks.map((workbook) => (
            <WorkbookCard
              key={workbook.id}
              workbook={workbook}
              onChanged={(list) => (list ? replace(list) : reload())}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
