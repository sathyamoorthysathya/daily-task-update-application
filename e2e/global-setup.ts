import { mkdir, rm } from 'node:fs/promises';
import { deleteTestUsers } from './tests/support/db.ts';
import { EXTERNAL_URL, STORAGE_DIR } from './settings.ts';

/** Starts every run from a clean state: no leftover accounts or workbook files. */
export default async function globalSetup(): Promise<void> {
  if (EXTERNAL_URL) {
    return; // a deployed site: no access to its database or files
  }
  await deleteTestUsers();
  await rm(STORAGE_DIR, { recursive: true, force: true });
  await mkdir(STORAGE_DIR, { recursive: true });
}
