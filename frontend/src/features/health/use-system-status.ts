import { useCallback, useEffect, useState } from 'react';
import { fetchSystemStatus } from './health.api';
import type { SystemStatus } from './health.types';

const CHECKING: SystemStatus = { api: 'checking', database: 'checking' };

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus>(CHECKING);
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSystemStatus(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });
    return () => {
      controller.abort();
    };
  }, [requestId]);

  const refresh = useCallback(() => {
    setStatus(CHECKING);
    setRequestId((id) => id + 1);
  }, []);

  return { status, refresh };
}
