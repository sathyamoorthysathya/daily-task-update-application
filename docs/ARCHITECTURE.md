# Architecture and features

How the Daily Task Update application works: its components, features, data model and API. For running it, see the [README](../README.md); for settings, see [CONFIGURATION.md](CONFIGURATION.md).

## Overview

```
Browser (React SPA) ──/api──▶ NestJS API ──▶ PostgreSQL (source of truth)
                                   │
                                   └── Excel worker ──▶ .xlsx files on disk (derived from PostgreSQL)
```

- **Frontend** (`frontend/`): React 19 + Vite. It talks to the API only through `/api` (the Vite proxy in development, nginx in Docker), so browser and API are same-origin and need no CORS setup.
- **Backend** (`backend/`): NestJS 12 (ESM), Prisma 7 with the `pg` driver adapter, Zod validation. Every route requires authentication unless it is marked `@Public()`.
- **Database:** PostgreSQL 18. All data lives here, including the security audit log. Excel files are generated from it.
- **Excel files:** one `.xlsx` per workbook in `WORKBOOK_STORAGE_DIR/<userId>/<workbookId>.xlsx`, written by a background worker.

### Frontend ↔ backend

- [`http-client.ts`](../frontend/src/lib/api/http-client.ts) wraps `fetch`. It:
  - sends cookies;
  - adds the CSRF header to unsafe requests;
  - refreshes the session once on `401` and retries;
  - throws `ApiError` carrying the backend error envelope (`code`, field `errors`).
- Concurrent `401`s share one refresh, and a Web Lock serialises refreshes across tabs.
- **Separate deployments:** to serve the web client and API separately, keep them on the same site (same registrable domain). Set `VITE_API_BASE_URL` to the absolute API URL and add the web origin to `CORS_ORIGINS`.

### Error format

Every API error has the same shape (`AllExceptionsFilter`):

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Task not found.",
  "code": "TASK_NOT_FOUND",
  "path": "/api/tasks/…",
  "method": "GET",
  "timestamp": "2026-11-07T07:37:18.841Z",
  "requestId": "0bbe656d-59ff-4565-93a3-e33f23b75325"
}
```

- `message` may be an array.
- Validation failures add `errors: [{ field, message }]` with `code: VALIDATION_FAILED`.
- Prisma errors map to statuses: `P2002`/`P2003` → 409, `P2025` → 404, connection failure → 503.
- Unexpected errors return a generic 500. The stack goes only to the log, and an alert is raised.
- `requestId` is also sent in the `X-Request-Id` header.

## Authentication

| Endpoint (`/api/auth`)  | Auth   | Purpose                                                                  |
| ----------------------- | ------ | ------------------------------------------------------------------------ |
| `GET /csrf`             | public | Issue the CSRF token (cookie + JSON)                                     |
| `GET /providers`        | public | Enabled sign-in providers (Google client ID)                             |
| `POST /register`        | public | Create an account `{ name, email, password }` and sign in                |
| `POST /login`           | public | Sign in `{ email, password }`                                            |
| `GET /google/nonce`     | public | Start Google sign-in (single-use nonce)                                  |
| `POST /google`          | public | Sign in with a Google ID token `{ credential }`                          |
| `POST /refresh`         | cookie | Rotate the refresh token and issue a new access token                    |
| `POST /logout`          | cookie | Revoke the current session                                               |
| `POST /logout-all`      | ✔      | Revoke every session of the user                                         |
| `GET /me`               | ✔      | Current user                                                             |
| `POST /forgot-password` | public | Email a reset link (always `202`, whether or not the email exists)       |
| `POST /reset-password`  | public | `{ token, password }`. Sets the password and signs out everywhere.       |
| `POST /change-password` | ✔      | `{ currentPassword, newPassword }`. Signs out the user's other sessions. |

- **Passwords:**
  - Hashed with Argon2id (m=19 MiB, t=2, p=1).
  - Policy: 8–128 characters with a letter and a number.
  - Login runs a dummy hash for unknown emails, so timing doesn't reveal which accounts exist.
- **Access token:** HS256 JWT `{ sub, sid }`, 15 minutes, in the `access_token` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production).
- **Refresh token:** 256-bit random value in the `refresh_token` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api/auth`). Only its SHA-256 hash is stored.
  - Every refresh rotates it. Reusing a rotated token revokes the whole session.
  - A session ends `SESSION_MAX_DAYS` after sign-in, however often it is refreshed.
- **Revocation:** access tokens are accepted only while their session is active, so logout and password reset take effect immediately.
- **CSRF:** a signed double-submit cookie. `csrf_token` must be echoed in `X-CSRF-Token` on every unsafe request, including login.
- **Rate limits:**
  - per IP;
  - per IP + email and per email (login);
  - per session (task and workbook changes).

  Client IPs come from `X-Forwarded-For` only for trusted proxies (`TRUST_PROXY`).

- **Password reset:** single-use 30-minute token, stored hashed. A reset revokes every session. Without `SMTP_URL` (outside production), the reset link is printed in the API log.
- **Ownership:**
  - `@OwnerOnly('id')` returns `403` for other users' IDs.
  - Workbook and task queries are always scoped to the signed-in user, and other users' records return `404`.

### Google sign-in

- Uses Google Identity Services (pop-up ID-token flow).
- The backend verifies the token with `google-auth-library`: signature, issuer, audience and expiry. It also checks a single-use nonce bound to the browser by an HttpOnly cookie, and that the email is verified.
- Accounts are matched by Google's stable `sub`. A new Google user gets a verified, password-less account.
- **Linking:** an existing account with the same email is linked.
  - If that account never proved ownership of its email, its password is removed and its sessions are revoked. This prevents account pre-hijacking; the owner can set a password later with "Forgot password".

## User profile

- **Fields:**
  - name (1–100);
  - email (read-only);
  - phone (international, 7–15 digits);
  - company (≤ 120) and job role (≤ 100);
  - industry (fixed list);
  - years of experience (0–60).
- **Profile picture:** JPEG, PNG or WebP up to 2 MB, detected from its bytes and re-encoded by `sharp` as a 256×256 WebP (metadata removed). Without one, the Google picture or the initials are shown.
- **Also on the page:** change password, connected Google account, sign out of all devices.

| Endpoint                                     | Purpose                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| `GET` / `PATCH /api/profile`                 | My profile; partial update (`null` clears a field)           |
| `GET /api/profile/industries`                | Allowed industries                                           |
| `GET` / `PUT` / `DELETE /api/profile/avatar` | Picture (WebP), upload (`multipart`, field `avatar`), remove |
| `GET` / `PATCH /api/users/:id`               | The same profile by ID (owner only)                          |

## Workbooks

- **First time:** a user without a workbook is sent to **Create your Excel sheet**. The first workbook becomes the default.
- **Workbooks page:**
  - list (name, date, task count, size, Excel sync state);
  - create, rename, set default;
  - download;
  - delete (confirm by typing the name).
- **The sheet "Daily Tasks":**
  - Columns: A Task Number · B Date · C Task Name · D Task Description · E Documentation Link / Reference · F Status.
  - Hidden internal ID columns: G Task ID · H Task Update ID.
  - Styled, frozen header with filters; a status drop-down and colours.
  - Only `http(s)` references become links. Text is never stored as a formula.
- **Storage:**
  - Files are on disk; metadata (size, SHA-256, versions) is in PostgreSQL.
  - Paths are built only from UUIDs (also enforced by a database CHECK).
  - Writes are atomic (temp file, `fsync`, rename).
  - A download is verified against its SHA-256. A missing, stale or modified file is rebuilt from the database first.
- **Concurrency:**
  - PostgreSQL advisory locks per user (create, delete, default) and per workbook file.
  - Renames and deletes need the `version` (`409` when stale).

| Endpoint (`/api/workbooks`) | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `GET /`                     | My workbooks, `defaultWorkbookId`, `limit`          |
| `POST /`                    | Create `{ name, makeDefault? }`                     |
| `GET /:id`                  | One workbook                                        |
| `PATCH /:id`                | Rename `{ name, version }`                          |
| `POST /:id/default`         | Make it the default                                 |
| `DELETE /:id?version=n`     | Delete the workbook, its tasks and its file         |
| `GET /:id/download`         | Download the `.xlsx` file                           |
| `POST /:id/sync`            | Manual resync (`202`)                               |
| `GET /:id/sync-status`      | Sync state, job counts, next retry, user-safe error |

## Daily tasks

**Task form (`/tasks/new`):**

- **Workbook:** the default is pre-selected.
- **Task number:** automatic, sequential per workbook, never reused.
- **Date:** today by default; up to one year ahead.
- **Name:** 1–200 characters.
- **Description:** required, ≤ 5000 characters.
- **Reference:** optional plain text, or an `http(s)` link.
- **Status:** To Do, In Progress, Pending, Completed or On Hold.

**Duplicates:** names are matched within the workbook, ignoring case and extra spaces. On save, the API answers `409 TASK_ALREADY_EXISTS` and the dialog offers:

| Option                          | What happens                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| **Update Existing Task**        | Edits the entry for that date (else the latest); old values go to the task history |
| **Create New Daily Task Entry** | Adds a dated entry to the same task (same number); earlier entries are unchanged   |
| **Cancel**                      | Nothing is saved                                                                   |

**Task list (`/tasks`):**

- Search: a name, or `#12` for a task number.
- Filters: status, workbook, date range.
- Sort: latest, oldest, number or name.
- Pagination: 10, 20 or 50 per page.
- The filters are kept in the URL.

**Task detail (`/tasks/:id`):**

- All dated entries, each editable.
- Rename, and edit the latest entry.
- History in plain language.
- Delete with confirmation.

**Integrity:**

- Every change runs in one transaction: task, entry, history, workbook counters and an Excel sync job.
- Unique constraints (`workbook + name`, `workbook + number`, `task + date`) settle concurrent submissions.
- Edits use optimistic locking (`version`).
- Row locks are always taken workbook → task, so they can't deadlock.
- **Delete is a soft delete:** the task, its entries and its history stay in PostgreSQL and a `TASK_DELETED` snapshot is recorded. The task disappears from lists and Excel, its name can be reused, and its number is not.

| Endpoint (`/api/tasks`)                                             | Purpose                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /?search=&status=&workbookId=&from=&to=&sort=&page=&pageSize=` | One page of tasks `{ items, page, pageSize, total, totalPages }` |
| `POST /`                                                            | Create a task and its first entry (`409` if it exists)           |
| `GET /lookup?name=&workbookId=&entryDate=`                          | Find a task with the same name (for the dialog)                  |
| `GET /summary?today=&days=`                                         | Dashboard figures                                                |
| `GET /recent-updates?workbookId=&limit=`                            | Latest entries (all workbooks when `workbookId` is omitted)      |
| `GET /:taskId`                                                      | Task with workbook, entries (newest first) and history           |
| `PATCH /:taskId`                                                    | Rename `{ name, version }`                                       |
| `DELETE /:taskId?version=n`                                         | Delete (soft)                                                    |
| `POST /:taskId/updates`                                             | New daily entry                                                  |
| `PATCH /:taskId/updates/:updateId`                                  | Edit an entry `{ status, description, reference, version }`      |

## Dashboard

The dashboard (`/dashboard`) shows:

- a welcome banner with today's numbers and the completion rate;
- four key figures, each with a small daily chart: total tasks, entries this week (vs the previous 7 days), completed, open tasks;
- a daily activity chart for the last 14 days;
- tasks by status (donut chart);
- recent task updates;
- progress per workbook, with its Excel sync state;
- system status.

`GET /api/tasks/summary` computes the figures with grouped queries, for the signed-in user only. It uses the browser's local date as "today".

The app layout has:

- a sidebar (a slide-in menu on small screens);
- a top bar with task search (`/tasks?search=`), the user and sign-out.

## Excel synchronisation

PostgreSQL is the source of truth. Excel files are rebuilt from it in the background, so Excel can never slow down, block or undo a saved change.

1. A task change is saved together with a job in `excel_sync_jobs`, in the same transaction (transactional outbox). The API answers at once with `excelSync: { status: "queued", jobId }`.
2. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, which is safe across several API processes. It rebuilds the sheet under the workbook's advisory lock and writes it atomically. One write also completes any other jobs it already covers.
3. A failure is retried with exponential backoff and jitter. After `EXCEL_SYNC_MAX_ATTEMPTS` the job is `DEAD`, the workbook shows **Excel update failed**, and an alert is raised.
4. **Recovery:**
   - Jobs left by a crashed worker are reclaimed after a lease.
   - At startup, workbooks whose file is behind get a recovery job.
   - Downloads rebuild a stale file first.
5. The hidden ID columns and the full rebuild guarantee one row per task entry. There are never duplicates.

| Workbook state | Meaning                              | Shown as                               |
| -------------- | ------------------------------------ | -------------------------------------- |
| `synced`       | The file contains every saved change | Excel up to date                       |
| `pending`      | A change is queued or being written  | Updating Excel…                        |
| `retrying`     | A write failed and will be retried   | Excel update retrying + **Resync now** |
| `failed`       | Retries exhausted (alert raised)     | Excel update failed + **Resync now**   |

Users only see a safe description of errors. The raw error is in `excel_sync_jobs.last_error` and the logs.

## Data model

| Table                                     | Contents                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `users`, `auth_accounts`                  | Accounts and linked Google identities                                                     |
| `refresh_tokens`, `password_reset_tokens` | Sessions (hashed tokens, rotation, session start) and reset links (hashed)                |
| `user_profiles`, `user_avatars`           | Profile details; picture bytes (kept separate)                                            |
| `workbooks`                               | Metadata, task-number counter, `data_version` / `synced_version`                          |
| `tasks`, `task_updates`                   | Task master record (soft delete) and its dated entries                                    |
| `task_history`                            | Append-only audit trail of task changes (an `UPDATE` trigger rejects changes)             |
| `excel_sync_jobs`                         | Excel synchronisation outbox                                                              |
| `audit_events`                            | Append-only security audit log (no foreign keys: it survives deleted users and workbooks) |

**Main indexes:**

- `tasks (user_id, last_entry_date)`;
- a trigram index on task names (search);
- unique `task_updates (task_id, entry_date)`;
- `excel_sync_jobs (status, next_attempt_at)`;
- `audit_events (user_id, created_at)`.

Database sessions run in UTC (see [prisma.service.ts](../backend/src/database/prisma.service.ts)).

**Changing the schema:**

```bash
npm run prisma:migrate -w backend -- --name <change>   # create + apply a migration (development)
npm run prisma:deploy -w backend                       # apply committed migrations
npm run prisma:generate -w backend                     # regenerate the Prisma client
npm run prisma:studio -w backend                       # browse the data
```

## Security and operations

These are covered in detail in [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [DEPLOYMENT.md](DEPLOYMENT.md):

- secure HTTP headers;
- the audit log;
- health checks (`/api/health/live`, `/api/health`);
- graceful shutdown;
- JSON logs with request IDs;
- alerts;
- backups;
- CI/CD.

The full interactive API reference is served at `/api/docs` (Swagger) outside production.
