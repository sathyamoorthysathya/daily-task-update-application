import { env } from '../../config/env';
import { ApiError } from './api-error';
import { CSRF_HEADER, getCsrfToken, resetCsrfToken } from './csrf';
import { emitSessionExpired } from './session-events';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Sent as-is when FormData (file uploads), otherwise serialised as JSON. */
  body?: unknown;
  /** 'blob' returns a DownloadedFile instead of parsed JSON. */
  responseType?: 'json' | 'blob';
}

export interface DownloadedFile {
  blob: Blob;
  /** From Content-Disposition (UTF-8 `filename*` preferred), or undefined. */
  filename?: string;
}

/** Extracts the file name from a Content-Disposition header. */
export function fileNameFromDisposition(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  const encoded = /filename*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // fall through to the plain filename
    }
  }
  return /filename="([^"]*)"/i.exec(header)?.[1];
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Endpoints whose 401 means "wrong credentials", not "access token expired". */
const NO_REFRESH_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/google',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

function buildUrl(path: string): string {
  return `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function send(path: string, options: RequestOptions): Promise<unknown> {
  const { body, headers: initHeaders, responseType = 'json', ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(initHeaders);
  headers.set('Accept', 'application/json');
  const isFormData = body instanceof FormData;
  // FormData sets its own multipart Content-Type (with boundary).
  if (body !== undefined && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  if (UNSAFE_METHODS.has(method)) {
    headers.set(CSRF_HEADER, await getCsrfToken());
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      ...init,
      method,
      headers,
      // Authentication travels in HttpOnly cookies.
      credentials: 'include',
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError('Unable to reach the API', 0, undefined, { cause });
  }

  if (response.ok && responseType === 'blob') {
    const file: DownloadedFile = {
      blob: await response.blob(),
      filename: fileNameFromDisposition(response.headers.get('Content-Disposition')),
    };
    return file;
  }
  const data = await parseBody(response);
  if (!response.ok) {
    throw ApiError.fromResponse(response.status, data);
  }
  return data;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotates the session via POST /auth/refresh. Concurrent callers share one request, and a
 * Web Lock serialises refreshes across tabs (they share the single-use refresh cookie).
 */
export function refreshSession(): Promise<boolean> {
  const run = () =>
    send('/auth/refresh', { method: 'POST' }).then(
      () => true,
      () => false,
    );
  refreshInFlight ??= (
    typeof navigator !== 'undefined' && 'locks' in navigator
      ? navigator.locks.request('dtu-auth-refresh', run)
      : run()
  ).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Fetch wrapper for the backend API: JSON in/out, cookies + CSRF header, and transparent
 * session refresh. A 401 triggers one refresh-and-retry; if the refresh fails, listeners of
 * `onSessionExpired` are notified and the error is rethrown.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return (await send(path, options)) as T;
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.status === 403 && error.code === 'CSRF_TOKEN_INVALID') {
      resetCsrfToken();
      return (await send(path, options)) as T;
    }
    if (error.status === 401 && !NO_REFRESH_PATHS.has(path)) {
      if (await refreshSession()) {
        return (await send(path, options)) as T;
      }
      emitSessionExpired();
    }
    throw error;
  }
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  /** GETs a file (with the same session refresh and error handling as other requests). */
  download: (path: string, options?: RequestOptions) =>
    apiRequest<DownloadedFile>(path, { ...options, method: 'GET', responseType: 'blob' }),
};

/** Saves a downloaded file through the browser's download mechanism. */
export function saveFile(file: DownloadedFile, fallbackName: string): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename ?? fallbackName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
