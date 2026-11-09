import { defineConfig } from 'vitest/config';
import { E2E_WORKBOOK_STORAGE_DIR } from './test/support/e2e-storage.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // e2e suites share one database; run them sequentially.
    fileParallelism: false,
    globalSetup: ['./test/support/e2e-storage.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Overrides for backend/.env (process env takes precedence over the .env file).
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      AUTH_RATE_LIMIT: '10000',
      LOGIN_RATE_LIMIT: '5',
      LOGIN_ACCOUNT_RATE_LIMIT: '10',
      // supertest connects over loopback: X-Forwarded-For simulates clients behind a proxy.
      TRUST_PROXY: 'true',
      SMTP_URL: '',
      // Isolated workbook storage, removed after the run (see e2e-storage.ts).
      WORKBOOK_STORAGE_DIR: E2E_WORKBOOK_STORAGE_DIR,
      MAX_WORKBOOKS_PER_USER: '5',
      // Excel sync jobs are processed explicitly with ExcelSyncWorker.drain() (deterministic);
      // the excel-sync suite starts the background loop itself where it tests it.
      EXCEL_SYNC_WORKER_ENABLED: 'false',
      EXCEL_SYNC_MAX_ATTEMPTS: '3',
      EXCEL_SYNC_RETRY_BASE_MS: '1000',
      EXCEL_SYNC_RETRY_MAX_MS: '60000',
      EXCEL_SYNC_POLL_MS: '100',
      EXCEL_SYNC_LEASE_MS: '120000',
    },
  },
});
