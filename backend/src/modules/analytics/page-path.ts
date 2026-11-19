const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d+$/;
/** Characters allowed in a route segment (anything else is not one of the app's pages). */
const SEGMENT = /^[A-Za-z0-9._~:-]+$/;

export const PAGE_PATH_MAX_LENGTH = 200;

/**
 * The route of a visited page, without anything personal: the query string and fragment are
 * dropped (they can hold search terms or reset tokens) and IDs become ":id". Returns null for
 * values that are not a plain app path, and for admin pages (not product usage).
 */
export function normalizePagePath(raw: string): string | null {
  const path = raw.split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || path.length > PAGE_PATH_MAX_LENGTH) {
    return null;
  }
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments[0]?.toLowerCase() === 'admin') {
    return null;
  }
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      return null;
    }
    normalized.push(UUID.test(segment) || NUMBER.test(segment) ? ':id' : segment.toLowerCase());
  }
  return `/${normalized.join('/')}`;
}
