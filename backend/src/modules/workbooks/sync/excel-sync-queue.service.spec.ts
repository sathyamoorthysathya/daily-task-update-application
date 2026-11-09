import { deriveSyncState, type SyncJobCounts } from './excel-sync-queue.service.js';

const none: SyncJobCounts = { pending: 0, processing: 0, failed: 0, dead: 0 };
const current = { dataVersion: 4, syncedVersion: 4 };

describe('deriveSyncState', () => {
  it('is synced when the file has every change and no job is open', () => {
    expect(deriveSyncState(none, current)).toBe('synced');
  });

  it('is pending while a job is queued or being processed', () => {
    expect(deriveSyncState({ ...none, pending: 1 }, current)).toBe('pending');
    expect(deriveSyncState({ ...none, processing: 1 }, current)).toBe('pending');
  });

  it('is pending when the file is behind even without a job (recovery will queue one)', () => {
    expect(deriveSyncState(none, { dataVersion: 5, syncedVersion: 4 })).toBe('pending');
  });

  it('is retrying while a failed job waits for its next attempt', () => {
    expect(deriveSyncState({ ...none, pending: 2, failed: 1 }, current)).toBe('retrying');
  });

  it('is failed once a job exhausted its retries, whatever else is open', () => {
    expect(deriveSyncState({ pending: 1, processing: 1, failed: 1, dead: 1 }, current)).toBe(
      'failed',
    );
  });
});
