import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { WorkbookSyncState, WorkbookSyncStatus } from '../workbook.types';
import { workbooksApi } from '../workbooks.api';

interface Props {
  workbookId: string;
  /** Delay between status checks. */
  pollMs?: number;
  /** Stop checking after this many attempts (the file is then still updated in the background). */
  maxPolls?: number;
}

const FIRST_CHECK_MS = 400;

const TEXT: Record<WorkbookSyncState, string> = {
  pending: 'Updating the Excel workbook…',
  synced: 'The Excel workbook is up to date.',
  retrying: 'The Excel update failed and will be retried automatically.',
  failed: 'The Excel workbook could not be updated.',
};

/**
 * Live status of the background Excel update after a change: the change is already saved in
 * the database; this follows the workbook's sync job until the file is written (or failed).
 * Give it a new `key` for each change so that it starts over.
 */
export function ExcelSyncNotice({ workbookId, pollMs = 1000, maxPolls = 60 }: Props) {
  const [status, setStatus] = useState<WorkbookSyncStatus | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const check = async () => {
      polls += 1;
      const next = await workbooksApi.syncStatus(workbookId).catch(() => null);
      if (!active) {
        return;
      }
      if (next) {
        setStatus(next);
      }
      const settled = next?.state === 'synced' || next?.state === 'failed';
      if (settled) {
        return;
      }
      if (polls >= maxPolls) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(() => void check(), pollMs);
    };
    // The worker is woken right after the save, so the first check comes sooner.
    timer = setTimeout(() => void check(), Math.min(pollMs, FIRST_CHECK_MS));

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [workbookId, pollMs, maxPolls]);

  const state = status?.state ?? 'pending';
  const text =
    gaveUp && state === 'pending'
      ? 'The Excel workbook will be updated in the background.'
      : TEXT[state];

  return (
    <span className={`excel-sync-notice excel-sync-notice--${state}`} role="status">
      {text}
      {state === 'failed' && (
        <>
          {status?.lastError && <> ({status.lastError})</>} Your task is saved;{' '}
          <Link to="/workbooks">resynchronise the workbook</Link> to retry.
        </>
      )}
    </span>
  );
}
