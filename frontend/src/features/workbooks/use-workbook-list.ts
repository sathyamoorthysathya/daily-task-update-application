import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../lib/api/api-error';
import type { WorkbookList } from './workbook.types';
import { workbooksApi } from './workbooks.api';

export type WorkbookListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: WorkbookList };

/** Loads the signed-in user's workbooks; `reload` refetches without clearing the current list. */
export function useWorkbookList() {
  const [state, setState] = useState<WorkbookListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    workbooksApi.list().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) => active && setState({ status: 'error', message: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback((data: WorkbookList) => setState({ status: 'ready', data }), []);

  return { state, reload, replace };
}
