import { useEffect, useState } from 'react';
import { useNetworkBusy, useOnline } from '../lib/api/network-activity';

/** Requests faster than this never show the progress bar (no flicker on a fast network). */
const SHOW_PROGRESS_AFTER_MS = 300;
/** A request still running after this long is announced as a slow connection. */
const SLOW_REQUEST_MS = 8000;

/** `value` once it has stayed true for `delayMs`; false as soon as it turns false. */
function useDelayedTrue(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) {
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => {
      clearTimeout(timer);
      // Next time it starts over from "not yet".
      setDelayed(false);
    };
  }, [value, delayMs]);
  return value && delayed;
}

/**
 * App-wide network feedback, on every page: a thin progress bar at the top while the app is
 * waiting for the server, a notice when that takes unusually long, and a banner while the
 * browser is offline.
 */
export function NetworkStatus() {
  const busy = useNetworkBusy();
  const online = useOnline();
  const showProgress = useDelayedTrue(busy, SHOW_PROGRESS_AFTER_MS);
  const slow = useDelayedTrue(busy, SLOW_REQUEST_MS);

  return (
    <>
      <div className="top-progress" data-active={showProgress || undefined} aria-hidden="true" />
      {!online ? (
        <div className="network-banner network-banner--offline" role="alert">
          You’re offline. Pages can’t load and changes can’t be saved until your internet connection
          is back.
        </div>
      ) : (
        slow && (
          <div className="network-banner" role="status">
            <span className="loader-spinner loader-spinner--small" aria-hidden="true" />
            Slow connection — still working on it…
          </div>
        )
      )}
    </>
  );
}
