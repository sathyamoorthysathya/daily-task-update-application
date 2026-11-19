import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../lib/api/api-error';

export type AdminData<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; message: string; data?: T }
  | { status: 'ready'; data: T };

/**
 * Loads admin data when the dependencies change. While a new load runs, the previous data
 * stays on screen (filters and pages switch without flashing a skeleton).
 */
export function useAdminData<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AdminData<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) =>
        active &&
        setState((current) => ({
          status: 'error',
          message: errorMessage(error),
          data: current.data,
        })),
    );
    return () => {
      active = false;
      // The next load starts: show it as loading (keeping the current data on screen).
      setState((current) => ({ status: 'loading', data: current.data }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what `load` uses
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback((data: T) => setState({ status: 'ready', data }), []);

  return { state, reload, replace };
}
