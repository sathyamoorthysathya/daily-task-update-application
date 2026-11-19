import pg from 'pg';
import { ADMIN_USERNAME, databaseUrl, EMAIL_DOMAIN } from '../../settings.ts';

/** Runs a query against the test database (for setup, cleanup and verification only). */
export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** Deletes every account created by the browser tests; their data is removed by cascade. */
export async function deleteTestUsers(): Promise<void> {
  const pattern = `%@${EMAIL_DOMAIN}`;
  // Audit rows outlive users by design; remove the test accounts' rows explicitly.
  await query(
    'DELETE FROM audit_events WHERE email LIKE $1 OR user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [pattern],
  );
  await query(
    'DELETE FROM page_views WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [pattern],
  );
  await query('DELETE FROM users WHERE email LIKE $1', [pattern]);
}

/** Deletes the test administrator (its password is in this repository) and its audit rows. */
export async function deleteTestAdmin(): Promise<void> {
  await query(
    'DELETE FROM audit_events WHERE admin_id IN (SELECT id FROM admin_users WHERE username = $1)',
    [ADMIN_USERNAME],
  );
  await query('DELETE FROM admin_users WHERE username = $1', [ADMIN_USERNAME]);
}
