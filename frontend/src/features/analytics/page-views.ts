import { env } from '../../config/env';
import { apiClient } from '../../lib/api/http-client';

const VISITOR_KEY = 'dtu-visitor-id';
/** The same page reported again within this time is one visit (re-renders, Strict Mode). */
const DEDUPE_MS = 1_000;

let memoryVisitorId: string | null = null;
let last: { path: string; at: number } | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for old browsers: RFC 4122 version 4 layout from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

/** Random ID for this browser (counts unique visitors). Not linked to any personal data. */
export function visitorId(): string {
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored) {
      return stored;
    }
    const created = randomId();
    localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode, policies): one ID per page load.
    memoryVisitorId ??= randomId();
    return memoryVisitorId;
  }
}

/**
 * Tells the server a page was opened: its path only (the server replaces IDs), never the
 * query string. Admin pages are not counted. Failures are ignored: tracking never gets in the
 * way of using the app.
 */
export function reportPageView(pathname: string): void {
  if (!env.analyticsEnabled || pathname === '/admin' || pathname.startsWith('/admin/')) {
    return;
  }
  const now = Date.now();
  if (last && last.path === pathname && now - last.at < DEDUPE_MS) {
    return;
  }
  last = { path: pathname, at: now };
  apiClient
    .post('/analytics/page-views', { path: pathname, visitorId: visitorId() }, { background: true })
    .catch(() => undefined);
}
