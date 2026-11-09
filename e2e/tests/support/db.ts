import pg from 'pg';
import { databaseUrl, EMAIL_DOMAIN } from '../../settings.ts';

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
  await query('DELETE FROM users WHERE email LIKE $1', [pattern]);
}
