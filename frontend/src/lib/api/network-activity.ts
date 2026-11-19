import { useSyncExternalStore } from 'react';

/**
 * Counts API requests in flight, so the app can show one shared progress indicator (and a
 * "slow connection" notice) for every request, whichever page started it.
 */
let pending = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Runs `request`, counting it as in flight until it settles. */
export async function trackRequest<T>(request: () => Promise<T>): Promise<T> {
  pending += 1;
  notify();
  try {
    return await request();
  } finally {
    pending -= 1;
    notify();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while at least one API request is in flight. */
export function useNetworkBusy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending > 0,
    () => false,
  );
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** False while the browser reports that there is no network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
