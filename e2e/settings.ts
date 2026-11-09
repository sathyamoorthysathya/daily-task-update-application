import { existsSync } from 'node:fs';
import path from 'node:path';

/** Shared settings of the Playwright run (config, global setup and tests). */
export const E2E_DIR = import.meta.dirname;
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4174);
export const API_URL = `http://localhost:${API_PORT}`;
/**
 * E2E_BASE_URL: test an already running deployment (e.g. staging, or the Docker stack) instead
 * of starting the apps. Tests that need direct access to the server's files or database skip.
 */
export const EXTERNAL_URL = process.env.E2E_BASE_URL?.replace(/\/+$/, '');
export const WEB_URL = EXTERNAL_URL ?? `http://localhost:${WEB_PORT}`;
/** Workbook files of the API started for the tests (tests manipulate them to cause failures). */
export const STORAGE_DIR = path.join(E2E_DIR, '.storage', 'workbooks');
/** Every account created by the browser tests uses this domain (and is deleted afterwards). */
export const EMAIL_DOMAIN = 'playwright.test';

// Local runs reuse backend/.env (DATABASE_URL, secrets); CI passes them as environment variables.
const backendEnv = path.join(E2E_DIR, '..', 'backend', '.env');
if (!process.env.DATABASE_URL && existsSync(backendEnv)) {
  process.loadEnvFile(backendEnv);
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set (and backend/.env was not found)');
  }
  return url;
}
