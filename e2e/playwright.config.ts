import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import {
  API_PORT,
  API_URL,
  E2E_DIR,
  EXTERNAL_URL,
  STORAGE_DIR,
  WEB_PORT,
  WEB_URL,
} from './settings.ts';

const CI = Boolean(process.env.CI);
/** Skip rebuilding the apps (e.g. when CI built them in an earlier step). */
const build = process.env.E2E_SKIP_BUILD ? '' : 'npm run build && ';

/**
 * Browser end-to-end tests against the production builds of the API and the web client, with a
 * real PostgreSQL database. Playwright starts both servers on their own ports (3100 / 4174), so
 * a running `npm run dev` is not affected.
 *
 * Browser: the bundled Chromium (`npx playwright install chromium`), or an installed browser
 * with PW_CHANNEL=msedge / chrome.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: EXTERNAL_URL
    ? []
    : [
        {
          name: 'api',
          cwd: path.join(E2E_DIR, '..', 'backend'),
          command: `${build}node dist/main.js`,
          url: `${API_URL}/api/health`,
          timeout: 180_000,
          reuseExistingServer: !CI,
          stdout: 'ignore',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'test',
            PORT: String(API_PORT),
            CORS_ORIGINS: WEB_URL,
            FRONTEND_URL: WEB_URL,
            WORKBOOK_STORAGE_DIR: STORAGE_DIR,
            GOOGLE_CLIENT_ID: '',
            SMTP_URL: '',
            // Many accounts are created from one machine in a short time.
            API_RATE_LIMIT: '100000',
            AUTH_RATE_LIMIT: '10000',
            LOGIN_RATE_LIMIT: '100',
            LOGIN_ACCOUNT_RATE_LIMIT: '100',
            WRITE_RATE_LIMIT: '10000',
            EXCEL_SYNC_WORKER_ENABLED: 'true',
            EXCEL_SYNC_POLL_MS: '250',
            EXCEL_SYNC_RETRY_BASE_MS: '1000',
            LOG_FORMAT: 'json',
          },
        },
        {
          name: 'web',
          cwd: path.join(E2E_DIR, '..', 'frontend'),
          command: `${build}npx vite preview --port ${WEB_PORT} --strictPort`,
          url: WEB_URL,
          timeout: 180_000,
          reuseExistingServer: !CI,
          stdout: 'ignore',
          env: { API_PROXY_TARGET: API_URL, VITE_API_BASE_URL: '/api' },
        },
      ],
});
