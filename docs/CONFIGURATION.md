# Configuration

Every setting, by file. The API validates its settings at startup ([env.schema.ts](../backend/src/config/env.schema.ts)) and refuses to start if one is invalid; the message names the setting.

| File                     | Used by                                              | Template                  |
| ------------------------ | ---------------------------------------------------- | ------------------------- |
| `backend/.env`           | The API when run with npm (running locally)          | `backend/.env.example`    |
| `frontend/.env`          | The web client when run with npm (optional)          | `frontend/.env.example`   |
| `.env` (root)            | `docker-compose.yml` (running with Docker; optional) | `.env.example`            |
| `.env.production` (root) | `docker-compose.prod.yml` (production)               | `.env.production.example` |

All `.env` files are git-ignored. Only the `*.example` templates are committed.

## Docker, local (`.env` in the project root)

Everything has a default, so this file is optional.

| Variable                           | Default             | Description                                                     |
| ---------------------------------- | ------------------- | --------------------------------------------------------------- |
| `POSTGRES_USER`                    | `dtu_user`          | Database user                                                   |
| `POSTGRES_PASSWORD`                | `dtu_password`      | Database password                                               |
| `POSTGRES_DB`                      | `daily_task_update` | Database name                                                   |
| `POSTGRES_PORT`                    | `5433`              | Host port of the Docker database (5432 is left for a local one) |
| `WEB_PORT`                         | `8080`              | The app is served at `http://localhost:<WEB_PORT>`              |
| `GOOGLE_CLIENT_ID`                 | _(empty)_           | Enables Google sign-in                                          |
| `JWT_ACCESS_SECRET`, `CSRF_SECRET` | local defaults      | Your own secrets (32+ characters each, different)               |

## API (`backend/.env`)

### Server

| Variable          | Default                 | Description                                                                                       |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `development`           | `development`, `test` or `production`                                                             |
| `PORT`            | `3000`                  | HTTP port                                                                                         |
| `API_PREFIX`      | `api`                   | Route prefix (`/api/...`)                                                                         |
| `DATABASE_URL`    | _(required)_            | `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public` (local: port 5432; Docker database: 5433) |
| `FRONTEND_URL`    | `http://localhost:5173` | Public URL of the web client (used in emails)                                                     |
| `CORS_ORIGINS`    | `http://localhost:5173` | Comma-separated allowed browser origins                                                           |
| `SWAGGER_ENABLED` | on, except production   | Swagger UI at `/api/docs`                                                                         |
| `TRUST_PROXY`     | `false`                 | Proxies trusted for `X-Forwarded-For`: `false`, `true` (loopback), a hop count, or subnets        |

### Authentication

| Variable                     | Default                                  | Description                                                                   |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`          | _(required, ≥ 32 chars)_                 | Key for access tokens                                                         |
| `CSRF_SECRET`                | _(required, ≥ 32 chars, ≠ JWT secret)_   | Key for CSRF tokens. In production, placeholder or weak secrets are rejected. |
| `ACCESS_TOKEN_TTL_SECONDS`   | `900`                                    | Access token lifetime                                                         |
| `REFRESH_TOKEN_TTL_DAYS`     | `7`                                      | Session lifetime since the last refresh                                       |
| `SESSION_MAX_DAYS`           | `30`                                     | Absolute session lifetime                                                     |
| `COOKIE_SECURE`              | `false`                                  | HTTPS-only cookies. **Must be `true` in production.**                         |
| `PASSWORD_RESET_TTL_MINUTES` | `30`                                     | Reset link lifetime                                                           |
| `GOOGLE_CLIENT_ID`           | _(empty = Google sign-in off)_           | OAuth 2.0 Web client ID                                                       |
| `SMTP_URL`                   | _(empty = log emails, development only)_ | e.g. `smtp://user:pass@smtp.example.com:587`                                  |
| `MAIL_FROM`                  | `Daily Task Update <no-reply@localhost>` | Sender address                                                                |

### Rate limits

| Variable                   | Default | Description                                         |
| -------------------------- | ------- | --------------------------------------------------- |
| `API_RATE_LIMIT`           | `300`   | Requests per IP per minute, any endpoint            |
| `AUTH_RATE_LIMIT`          | `20`    | Requests per IP per minute to public auth endpoints |
| `LOGIN_RATE_LIMIT`         | `5`     | Login attempts per IP + email per 15 minutes        |
| `LOGIN_ACCOUNT_RATE_LIMIT` | `20`    | Login attempts per email from any IP per 15 minutes |
| `WRITE_RATE_LIMIT`         | `60`    | Task and workbook changes per session per minute    |

### Workbooks and Excel synchronisation

| Variable                    | Default             | Description                                                                   |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `WORKBOOK_STORAGE_DIR`      | `storage/workbooks` | Folder for `.xlsx` files (absolute, or relative to `backend/`). Must persist. |
| `MAX_WORKBOOKS_PER_USER`    | `20`                | Workbooks per user                                                            |
| `MAX_ENTRIES_PER_WORKBOOK`  | `10000`             | Dated entries (Excel rows) per workbook                                       |
| `EXCEL_SYNC_WORKER_ENABLED` | `true`              | Run the background Excel worker in this process                               |
| `EXCEL_SYNC_POLL_MS`        | `2000`              | How often the worker looks for jobs (it is also woken after each change)      |
| `EXCEL_SYNC_CONCURRENCY`    | `2`                 | Jobs in parallel (one writer per workbook)                                    |
| `EXCEL_SYNC_MAX_ATTEMPTS`   | `8`                 | Attempts before a job is given up and an alert is raised                      |
| `EXCEL_SYNC_RETRY_BASE_MS`  | `5000`              | First retry delay; doubles each time (±20 % jitter)                           |
| `EXCEL_SYNC_RETRY_MAX_MS`   | `900000`            | Longest retry delay                                                           |
| `EXCEL_SYNC_LEASE_MS`       | `120000`            | A job still running after this long is assumed abandoned                      |

### Logging and monitoring

| Variable            | Default              | Description                                                        |
| ------------------- | -------------------- | ------------------------------------------------------------------ |
| `LOG_FORMAT`        | `text`               | `json`: one JSON object per log line                               |
| `ACCESS_LOG`        | on in production     | One log line per HTTP request, with its request ID                 |
| `ALERT_WEBHOOK_URL` | _(empty = log only)_ | Webhook (Slack, Teams, …) for failed Excel syncs and server errors |

## Web client (`frontend/.env`)

Optional; the defaults work.

| Variable            | Default                 | Description                                                     |
| ------------------- | ----------------------- | --------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`                  | API base URL used by the browser (keep `/api` to use the proxy) |
| `API_PROXY_TARGET`  | `http://localhost:3000` | Where the Vite dev/preview server forwards `/api` (not bundled) |

## Production (`.env.production`)

See [`.env.production.example`](../.env.production.example) and the [deployment guide](DEPLOYMENT.md#first-deployment).
