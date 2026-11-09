# Testing report

**Date:** 2026-11-09 (security results from 2026-11-08) · **Commit state:** working tree after the dashboard redesign and project clean-up

**Environment:** Windows 11, Node.js 26.9, PostgreSQL 18 (native), Docker 29.8 (Linux engine), Microsoft Edge (Chromium) for Playwright.

## Results

| Suite                                                                                                  | Files | Tests | Result                                                                |
| ------------------------------------------------------------------------------------------------------ | ----: | ----: | --------------------------------------------------------------------- |
| Backend unit (Vitest)                                                                                  |    16 |   127 | **127 passed**                                                        |
| Frontend components and units (Vitest + Testing Library)                                               |     9 |   104 | **104 passed**                                                        |
| API integration, database, auth, Excel sync, security, dashboard (Vitest + supertest, real PostgreSQL) |    10 |   149 | **149 passed**                                                        |
| Browser end-to-end (Playwright), local production builds                                               |     7 |    19 | **19 passed**, no retries                                             |
| Browser end-to-end (Playwright) against the local Docker stack (`docker-compose.yml`)                  |     7 |    19 | **18 passed, 1 skipped** (needs server file access, by design)        |
| Browser end-to-end (Playwright) against the production Docker stack (2026-11-08)                       |     6 |    17 | **16 passed, 1 skipped** (needs server file access, by design)        |
| `npm run verify` (format, lint, typecheck of all workspaces, unit tests, builds)                       |     — |     — | **passed**                                                            |
| `npm audit --omit=dev` (production dependencies)                                                       |     — |     — | **0 vulnerabilities**                                                 |
| `npm audit` (incl. dev tools)                                                                          |     — |     — | 10 moderate, all one ESLint `minimatch` advisory (dev only, accepted) |
| Production Docker stack: build, health, headers, shutdown, backup and restore                          |     — |     — | **passed** (details below)                                            |

**Not executed:** the GitHub Actions workflow (`.github/workflows/ci.yml`) has not run on GitHub yet, because the repository has not been pushed. Each of its steps was run locally with the same commands.

## Coverage of the required test areas

| Area                        | Where                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                  | `backend/src/**/*.spec.ts`: env validation (including production secret rules), CSRF, passwords, Google tokens, ownership, schemas, workbook template and storage, backoff, sync state, sync error text, exception filter, error reporter.                                                                                        |
| API integration tests       | `backend/test/*.e2e-spec.ts`: the real Nest app over HTTP with real PostgreSQL and a temporary storage folder.                                                                                                                                                                                                                    |
| Database tests              | `database.e2e-spec.ts`: every migration applied with none failed; UTC sessions; `pg_trgm`; unique and CHECK constraints (including storage-key path safety); append-only `task_history` and `audit_events`; cascades on user deletion (audit log survives); required indexes; no file contents stored except avatars.             |
| Authentication tests        | `auth.e2e-spec.ts` (27): registration, login, rate limits, CSRF, expired and tampered tokens, refresh rotation and reuse, logout, Google sign-in, password reset. `security.e2e-spec.ts`: absolute session lifetime, per-account brute-force limit. Playwright `auth.spec.ts`: redirects, sign-in and sign-out, HttpOnly cookies. |
| Excel synchronisation tests | `excel-sync.e2e-spec.ts` (12): outbox in the same transaction, non-blocking API, failures and retries with backoff, `DEAD` and alerts, manual resync, crashed-worker lease, recovery, duplicate prevention. Playwright `excel-sync.spec.ts`: a real write failure on the server, retrying badge, resync, file content.            |
| Multi-user authorization    | Every API suite checks cross-user access returns 404. Playwright `isolation.spec.ts` covers two browser contexts through UI and API: reads, edits, deletes, writes into another user's workbook, downloads.                                                                                                                       |
| Duplicate tasks             | `tasks.e2e-spec.ts` (case- and space-insensitive detection, nothing created, lookup). Playwright `tasks.spec.ts` (duplicate dialog: new daily entry, update existing, cancel; one Excel row per entry).                                                                                                                           |
| Concurrent updates          | API: identical and parallel submissions, unique numbering, racing edits and deletes, three concurrent workers with no overlapping file writes. Playwright: two tabs submitting at the same moment.                                                                                                                                |
| Frontend component tests    | `frontend/src/**/*.test.tsx`: dashboard (figures, charts, recent updates, error state), app layout (sidebar, search, mobile menu), auth flow, workbook pages and states, task form and duplicate dialog, task list, detail and edit, profile, HTTP client (CSRF, refresh, downloads), system status.                              |
| Playwright end-to-end tests | `e2e/tests/*.spec.ts`, 19 tests: dashboard (figures, search, mobile menu), auth, tasks and Excel downloads (hidden ID columns), duplicates, two tabs, task management (search, filter, edit, delete), isolation, Excel failure recovery, stored XSS, safe links, security headers, CSRF.                                          |

## Security tests added in Phase 9 (`security.e2e-spec.ts`, 16 tests)

- **HTTP hardening:**
  - Secure headers and a deny-all CSP on API responses; no `X-Powered-By`.
  - A request ID on every response and in error bodies; unsafe incoming IDs are replaced.
  - Credentialed CORS only for configured origins.
  - Oversized JSON is rejected with 413.
  - Path traversal and SQL injection attempts are rejected or harmless.
  - References with control characters are rejected (`java\tscript:`).
  - Avatar uploads accept a single file part only.
- **Rate limiting behind a proxy:**
  - Real client IPs: an attacker is throttled while the owner signs in from another IP.
  - Per-account limit across 11 rotating IPs.
  - Per-session write limit (the 61st change returns 429); other users are unaffected.
- **Sessions:**
  - Absolute lifetime enforced and audited.
  - Refresh tokens never outlive the session.
- **Audit log:**
  - The full event sequence of an account is recorded, with IP, user agent and request ID, and no secrets.
  - Failed logins for unknown emails and refused CSRF requests are recorded.
  - The log is append-only and survives user deletion.
- **Resource limits:** the per-workbook entry cap (`409 WORKBOOK_FULL`).

## Production stack verification (Docker)

Run with `docker-compose.prod.yml` and throwaway secrets, then torn down with `down -v`:

1. **Build:** API, migration and web images built. Images: web 82 MB, API 965 MB (see finding L9).
2. **Start-up order:** PostgreSQL healthy → `migrate` applied all 9 migrations and exited 0 → API healthy (read-only root filesystem, non-root, capabilities dropped) → web healthy.
3. **Smoke checks:**
   - `/healthz` and `/api/health` both return ok.
   - The SPA fallback serves `/tasks`.
   - The production CSP and security headers are present on the web client and the API.
   - `/api/docs` returns 404 (Swagger off).
4. **Browser suite against `http://localhost:8080`:** 16 passed, 1 skipped (the Excel-failure test needs direct file access). This confirms that the CSP, secure cookies behind the proxy, and `TRUST_PROXY=1` work together.
5. **Graceful shutdown:** `docker compose stop api` took 0.7 s. Logs show `shutdown.started` → worker stopped → `Database connections closed`.
6. **Backup and restore:** `scripts/backup.sh` (15 users, 12 entries, 11 workbooks, 30 audit events; checksums written) → all users deleted and all files removed → `scripts/restore.sh --yes` (checksums verified, single-transaction restore). Afterwards all counts matched, all 11 files were present, and 11 of 11 workbooks were rebuilt and synced.

## Issues found by testing and fixed during Phase 9

- **Shutdown closed the database pool too early (M2 in the security audit).**
- **Health-detail stripping removed too much.** It also removed Terminus's `error` object; caught by a unit test.
- **Backups could be corrupted.** Streaming the archive through `docker compose run` stdout produced an unreadable file, so the backup scripts now use `docker cp` and a volume mount, with integrity checks.
- **Two frontend tests were timing-sensitive under load.** The Testing Library async timeout was raised to 5 s, which only lengthens the maximum wait.

## Known gaps

- No load or performance testing. The request and entry limits were chosen conservatively.
- Browser coverage is Chromium and Edge only. Firefox and WebKit can be added as Playwright projects.
- Google sign-in and SMTP delivery are tested with local fakes, not the real services.
- The CI workflow has not run on GitHub yet (see above).

## How to run

```bash
npm run verify                    # format, lint, typecheck, unit tests, builds
npm run test:e2e                  # API + database suites (PostgreSQL running, migrations applied)
npx playwright install chromium   # once (or set PW_CHANNEL=msedge / chrome)
npm run test:browser              # Playwright; builds and starts the API (3100) and web (4174)
E2E_BASE_URL=https://staging.example.com npm run test:browser   # against a deployment
```

Don't run the API e2e or browser suites while `npm run dev` uses the same database: its Excel worker would pick up the tests' jobs.
