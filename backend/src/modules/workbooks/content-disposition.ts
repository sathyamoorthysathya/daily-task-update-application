import { FORBIDDEN_NAME_CHARS } from './workbooks.schemas.js';

const FORBIDDEN_GLOBAL = new RegExp(FORBIDDEN_NAME_CHARS.source, 'g');

/**
 * `Content-Disposition: attachment` header for a workbook download. The user-chosen name is
 * sanitised: an ASCII-only `filename` for old clients plus an RFC 5987 `filename*` (UTF-8),
 * so quotes, separators or line breaks in names cannot alter the header.
 */
export function workbookContentDisposition(workbookName: string, extension = 'xlsx'): string {
  const base = workbookName.replace(FORBIDDEN_GLOBAL, '_').trim() || 'workbook';
  const fileName = `${base}.${extension}`;
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
