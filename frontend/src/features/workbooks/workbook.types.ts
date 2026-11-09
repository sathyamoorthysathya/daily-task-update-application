/**
 * Excel synchronisation state of a workbook (PostgreSQL is the source of truth):
 * - synced:   the file contains every saved change;
 * - pending:  a change is queued or being written in the background;
 * - retrying: a write failed and will be retried automatically;
 * - failed:   retries are exhausted; a manual resync is needed.
 */
export type WorkbookSyncState = 'synced' | 'pending' | 'retrying' | 'failed';

export interface Workbook {
  id: string;
  name: string;
  isDefault: boolean;
  taskCount: number;
  /** Number the next new task will most likely receive. */
  nextTaskNumber: number;
  sizeBytes: number;
  syncStatus: WorkbookSyncState;
  /** Error of the last failed sync attempt, while retrying or failed. */
  syncError: string | null;
  lastSyncedAt: string | null;
  /** Optimistic-locking version; send it back when renaming or deleting. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbookList {
  workbooks: Workbook[];
  defaultWorkbookId: string | null;
  limit: number;
}

export interface WorkbookSyncStatus {
  workbookId: string;
  state: WorkbookSyncState;
  dataVersion: number;
  syncedVersion: number;
  lastSyncedAt: string | null;
  pendingJobs: number;
  retryingJobs: number;
  failedJobs: number;
  nextRetryAt: string | null;
  lastError: string | null;
}
