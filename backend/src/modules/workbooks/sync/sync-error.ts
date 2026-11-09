/**
 * A user-facing description of an Excel synchronisation failure. Raw errors can contain server
 * paths and other internals: they stay in the job record, the logs and alerts only.
 */
export function describeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    (typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined) ?? /^([A-Z][A-Z0-9_]+)\b/.exec(message)?.[1];

  switch (code) {
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES':
    case 'EROFS':
    case 'EISDIR':
      return 'The Excel file is locked or cannot be written on the server.';
    case 'ENOSPC':
    case 'EDQUOT':
      return 'There is not enough storage space on the server to write the Excel file.';
    case 'EMFILE':
    case 'ENFILE':
    case 'EIO':
    case 'EAGAIN':
      return 'The server could not write the Excel file because of a temporary storage problem.';
    case 'P2028':
    case 'WORKBOOK_BUSY':
      return 'The workbook was busy for too long.';
    default:
      return 'An unexpected error occurred while writing the Excel file.';
  }
}
