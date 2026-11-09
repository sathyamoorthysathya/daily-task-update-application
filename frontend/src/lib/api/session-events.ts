type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribes to "the session could not be refreshed" events. Returns an unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  for (const listener of listeners) {
    listener();
  }
}
