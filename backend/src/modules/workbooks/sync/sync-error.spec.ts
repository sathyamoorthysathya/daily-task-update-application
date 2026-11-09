import { describeSyncError } from './sync-error.js';

describe('describeSyncError', () => {
  it('describes file-system errors by their code without exposing server paths', () => {
    const error = Object.assign(
      new Error("EPERM: operation not permitted, rename 'C:\\srv\\storage\\u1\\wb.xlsx.tmp'"),
      { code: 'EPERM' },
    );

    const text = describeSyncError(error);

    expect(text).toBe('The Excel file is locked or cannot be written on the server.');
    expect(text).not.toContain('storage');
  });

  it('recognises the code at the start of the message', () => {
    expect(describeSyncError(new Error('ENOSPC: no space left on device'))).toMatch(
      /not enough storage space/,
    );
  });

  it('falls back to a generic description', () => {
    expect(describeSyncError(new Error('something odd at /var/lib/app'))).toBe(
      'An unexpected error occurred while writing the Excel file.',
    );
    expect(describeSyncError('boom')).toBe(
      'An unexpected error occurred while writing the Excel file.',
    );
  });
});
