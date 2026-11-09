import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Workbook storage used by the e2e run (evaluated once, in the main Vitest process). */
export const E2E_WORKBOOK_STORAGE_DIR = path.join(tmpdir(), `dtu-e2e-workbooks-${process.pid}`);

/** Vitest global setup: removes the e2e workbook files after all suites have finished. */
export default function setup(): () => Promise<void> {
  return () => rm(E2E_WORKBOOK_STORAGE_DIR, { recursive: true, force: true });
}
