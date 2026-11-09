import { EXTERNAL_URL } from './settings.ts';
import { deleteTestUsers } from './tests/support/db.ts';

/** Removes the accounts (and, by cascade, the data) created by the browser tests. */
export default async function globalTeardown(): Promise<void> {
  if (EXTERNAL_URL) {
    return; // a deployed site: no access to its database or files
  }
  await deleteTestUsers();
}
