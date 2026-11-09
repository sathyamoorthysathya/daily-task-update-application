# Security and production-readiness audit

**Application:** Daily Task Update (NestJS API, React SPA, PostgreSQL, Excel workbooks on disk)
**Date:** 2026-11-08 · **Scope:** the whole repository: `backend/`, `frontend/`, Docker and CI configuration

## Summary

No critical issues were found. Three high-severity issues were found and fixed. Every fix is covered by automated tests.

| Severity | Found | Fixed | Mitigated | Accepted / open |
| -------- | ----: | ----: | --------: | --------------: |
| Critical |     0 |     — |         — |               — |
| High     |     2 |     2 |         — |               — |
| Medium   |     4 |     3 |         1 |               — |
| Low      |    10 |     6 |         1 |               3 |

**Verdict:** ready for production, provided the [go-live checklist](DEPLOYMENT.md#go-live-checklist) is followed. In particular: real secrets, HTTPS in front, a correct `TRUST_PROXY`, an alert webhook, and scheduled off-site backups.

### Method

1. A code review of every area listed below.
2. A second, independent read-only review of the code.
3. `npm audit` of production and development dependencies.
4. Dynamic checks against the production Docker stack: headers, health, shutdown, backup and restore, and the browser suite.

Each finding below was confirmed by reading the code, and each fix was verified by a test. See [TESTING_REPORT.md](TESTING_REPORT.md).

## Findings

### High

**H1. Rate limits collapse into one shared bucket behind the containerised proxy (fixed).**

- **Problem:** Express `trust proxy` only trusted a proxy on loopback. In the Docker deployment, nginx runs in another container, so every request appeared to come from nginx's IP. Anyone could lock any account out with 5 wrong passwords, since the per-IP+email limit became per-email for everyone. A few hundred users refreshing tokens behind one IP would hit the 20/min auth limit and be signed out.
- **Fix:**
  - `TRUST_PROXY` accepts `false`, `true` (loopback), a hop count, or addresses and subnets.
  - nginx forwards `X-Forwarded-For`, and the production template uses one or two hops.
  - `/auth/refresh` is no longer in the per-IP auth bucket. Refresh tokens are 256-bit random values, and the global per-IP limit still applies.
  - A new per-account limit (`LOGIN_ACCOUNT_RATE_LIMIT`, any IP) stops password guessing from rotating addresses.
- **Tests:** `security.e2e-spec.ts` (attacker IP throttled while the owner signs in from another IP; per-account limit across 11 IPs).

**H2. No secure HTTP headers (fixed).**

- **Problem:** The API and the web client sent no CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` or `Permissions-Policy`. `X-Powered-By` was exposed.
- **Fix:**
  - **API:** `helmet` with a deny-all CSP (`default-src 'none'`; the Swagger UI gets its own policy), HSTS, `no-referrer`, CORP `same-site`, and no `X-Powered-By`.
  - **Web (nginx):** a strict CSP that allows only this site and Google Identity Services (no inline scripts), plus `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS and `server_tokens off`.
- **Tests:** `security.e2e-spec.ts`, Playwright `security.spec.ts`, and a smoke test of the Docker stack. The full browser suite passes with the production CSP.

### Medium

**M1. Placeholder secrets passed production validation (fixed).**

- **Problem:** The `change-me…` example values are 32 or more characters long and different from each other, so a deployment that copied them would start, and anyone could forge access and CSRF tokens.
- **Fix:** With `NODE_ENV=production`, the API refuses to start when a secret contains a placeholder word or has fewer than 16 distinct characters.
- **Tests:** `env.schema.spec.ts`.

**M2. Graceful shutdown closed the database pool before work had finished (fixed).** Found during this audit.

- **Problem:** Nest runs `onModuleDestroy` (where Prisma disconnected) before `beforeApplicationShutdown` (where the Excel worker stops) and before the HTTP server closes. During every deploy, in-flight requests and Excel jobs failed against a closed pool. The outbox retried the jobs, but users saw errors.
- **Fix:**
  - Prisma disconnects in `onApplicationShutdown`, which runs last.
  - A hard 25-second shutdown timeout stays below the 30-second container grace period.
  - Each step is logged: `shutdown.started`, `excel_sync.worker_stopped`, `Database connections closed`.
- **Tests:** `docker compose stop api` in Docker shows the sequence, which completes in 0.7 s. This check is also part of CI.

**M3. Security-relevant events were not audited (fixed).**

- **Problem:** Only refresh-token reuse was logged. Deleting a workbook cascaded to its tasks and their `task_history`, leaving no trace.
- **Fix:** A new append-only `audit_events` table. It has no foreign keys, so records survive the deletion of users and workbooks, and a trigger blocks `UPDATE`. Each event records the IP, user agent and request ID, and is also written to the structured log without email addresses. Recorded events:
  - **Registration and sign-in:** register; password and Google login, success and failure with a reason.
  - **Sessions:** refresh-token reuse, absolute session expiry, logout, logout-all.
  - **Passwords:** password changed (and wrong current password), reset requested and completed.
  - **Access:** refused (403) requests.
  - **Profile:** profile and avatar changes.
  - **Workbooks:** workbook created, renamed, deleted (with name and task count) and resync requested.
- **Tests:** `security.e2e-spec.ts` and `database.e2e-spec.ts`.

**M4. Unbounded data with a full in-memory Excel rebuild on each change, a DoS risk (mitigated).**

- **Problem:** One account could grow a workbook without limit, and every change rebuilds the whole `.xlsx` in memory.
- **Fix:**
  - `MAX_ENTRIES_PER_WORKBOOK` (default 10,000) is enforced under the workbook row lock, returning `409 WORKBOOK_FULL`.
  - A per-session write limit `WRITE_RATE_LIMIT` (60 changes/min) and a configurable global `API_RATE_LIMIT` apply.
  - A crash loop is bounded: each attempt counts, and a job is marked `DEAD` after `EXCEL_SYNC_MAX_ATTEMPTS`.
- **Open:** the ExcelJS streaming writer, or a separate memory-limited worker process, for very large workbooks.

### Low

| #   | Finding                                                                                                                                                  | Status                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Swagger UI enabled by default in production                                                                                                              | **Fixed:** off by default when `NODE_ENV=production` (verified: `/api/docs` returns 404 in Docker)                                                                                  |
| L2  | Public `/api/health` returned internal error messages (paths, hosts)                                                                                     | **Fixed:** in production only indicator names and statuses are returned                                                                                                             |
| L3  | No absolute session lifetime: a rotating refresh token lived forever                                                                                     | **Fixed:** `SESSION_MAX_DAYS` (30); refresh tokens never outlive it; recorded as `auth.session_expired`                                                                             |
| L4  | Brute force only limited per IP+email                                                                                                                    | **Fixed:** per-account limit (see H1). IPv6 addresses are not grouped by /64: **open**, low                                                                                         |
| L5  | Avatar upload accepted unlimited extra multipart fields                                                                                                  | **Fixed:** `fields: 0, parts: 1, headerPairs: 20`                                                                                                                                   |
| L6  | Reference links: `java\tscript:` and control-character prefixes passed the `http(s)` check. Not exploitable, since only `^https?://` values become links | **Fixed:** control characters rejected in the API and the forms                                                                                                                     |
| L7  | Safety checks depend on `NODE_ENV` (default `development`)                                                                                               | **Mitigated:** the production image sets `NODE_ENV=production`; documented in the go-live checklist                                                                                 |
| L8  | Password policy: 8+ characters with a letter and a digit; no breached-password check                                                                     | **Open:** recommend a k-anonymity breached-password check and 12+ characters                                                                                                        |
| L9  | API image is 965 MB and contains unused tooling (the Prisma CLI is installed as a peer of `@prisma/client`)                                              | **Open:** recommend bundling the API. Impact is limited: the tooling is never executed, the container runs as non-root on a read-only root filesystem with all capabilities dropped |
| L10 | `npm audit` (dev dependencies only): 10 moderate findings, one `minimatch` ReDoS advisory through ESLint                                                 | **Accepted:** not shipped; the fix needs an ESLint major downgrade. Production dependencies: **0 vulnerabilities**                                                                  |

### Informational

- **Throttling is in memory.** Run one API instance, or add a shared store such as Redis before scaling out. See [DEPLOYMENT.md](DEPLOYMENT.md#scaling).
- **CSRF tokens are signed but not bound to a session.** Forgery is still blocked by the custom header requirement and the strict CORS allowlist.
- **Registration reveals whether an email is registered** (409). This is an accepted usability trade-off; login and password reset do not reveal it.
- **Not yet available:** a per-session device list, or account deletion by the user.

## Areas verified as sound

| Area                      | Evidence                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication            | Global JWT guard. `@Public()` only on the auth entry points and health. The session is checked in the database on every request, so logout and revocation take effect immediately.                                                                      |
| Authorization & isolation | Every workbook and task query is scoped by `userId`, and other users' resources return 404. `users/:id` returns 403 for anyone but the owner. Playwright `isolation.spec.ts` and API suites cover this.                                                 |
| Password security         | Argon2id (19 MiB, t=2, p=1). Unknown accounts get dummy verification, so timing doesn't reveal them. Changing the password revokes other sessions. Reset links are single-use, stored as SHA-256 hashes, expire in 30 minutes, and revoke all sessions. |
| JWT and refresh tokens    | HS256 pinned; issuer and audience checked; 15-minute access token. Refresh tokens are opaque, 256-bit, hashed, rotated, with reuse detection that revokes the whole session. Cookies: HttpOnly, Secure in production, SameSite Lax/Strict, path-scoped. |
| Input validation          | Zod schemas on every body, query and parameter; strict objects (no mass assignment); 100 KB JSON limit; pagination capped at 100.                                                                                                                       |
| CORS / CSRF               | Explicit origin allowlist with credentials. Signed double-submit CSRF on every unsafe method, including login.                                                                                                                                          |
| XSS                       | React escaping; no `dangerouslySetInnerHTML`; only `http(s)` links, opened with `rel="noopener noreferrer"`; production CSP. Stored-XSS payloads are tested in the browser.                                                                             |
| SQL injection             | Prisma queries and tagged `$queryRaw` templates only (parameterised); LIKE wildcards escaped.                                                                                                                                                           |
| Path traversal            | Storage keys are built from UUIDs, validated, resolved inside the storage root, and enforced by a database `CHECK`.                                                                                                                                     |
| Excel files               | Text is never written as formulas. Only `http(s)` values become hyperlinks. Downloads are verified by SHA-256 and rebuilt from the database if modified. `Content-Disposition` is sanitised. Uploaded images are re-encoded by `sharp`.                 |
| Secrets and configuration | Everything is validated at startup. `.env` files are ignored by git and Docker. Users get no stack traces, and 5xx errors are generic. Sync errors shown to users are sanitised.                                                                        |

## Remaining recommendations (non-blocking)

1. Add a breached-password check and raise the minimum password length (L8).
2. Bundle the API to shrink the image (L9).
3. Use the ExcelJS streaming writer for very large workbooks (M4).
4. Add a shared rate-limit store before running several API instances.
5. Group IPv6 clients by /64 for rate limiting (L4).
