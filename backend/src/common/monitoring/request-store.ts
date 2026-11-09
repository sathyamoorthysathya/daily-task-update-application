import { AsyncLocalStorage } from 'node:async_hooks';

/** Who sent the current request; available anywhere during that request (audit, errors). */
export interface RequestInfo {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const requestStore = new AsyncLocalStorage<RequestInfo>();

/** Information about the HTTP request being handled, if any. */
export function currentRequest(): RequestInfo | undefined {
  return requestStore.getStore();
}
