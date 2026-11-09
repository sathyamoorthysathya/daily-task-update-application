# Deployment guide

This guide covers deploying the Daily Task Update application with Docker Compose on one Linux server. To run the app on your own computer instead, see the [README](../README.md#run-the-project). It also covers operating it: backups, upgrades, monitoring and troubleshooting.

## Architecture

```
            HTTPS                    HTTP                       internal network "backend"
Browser ──────────▶ TLS proxy ─────────────▶ web (nginx :8080) ──/api──▶ api (NestJS :3000) ──▶ postgres (:5432)
                    (Caddy, nginx,           static SPA,                 + Excel sync worker     not published
                     cloud LB)               security headers            volume: workbook-data   volume: postgres-data
```

| Service    | Image                                   | Role                                                                                                                  |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:18-alpine`                    | Source of truth. Not published on the host.                                                                           |
| `migrate`  | `backend/Dockerfile` (target `migrate`) | One-shot job that runs `prisma migrate deploy` and exits. The API starts only if it succeeds.                         |
| `api`      | `backend/Dockerfile` (target `runtime`) | REST API and background Excel worker. Runs as non-root with a read-only root filesystem and all capabilities dropped. |
| `web`      | `frontend/Dockerfile`                   | nginx (unprivileged) serving the SPA, proxying `/api`, and adding the CSP and security headers.                       |

**Persistent data:**

- The `postgres-data` volume holds the database.
- The `workbook-data` volume holds the `.xlsx` files.

Both must be backed up. PostgreSQL is the source of truth: every Excel file can be rebuilt from it.

## Requirements

- A Linux server with Docker Engine 24+ and the Compose plugin; 2 vCPU, 2 GB RAM and 20 GB of disk to start.
- A DNS name and TLS certificate, terminated by a reverse proxy in front of the `web` container.
- An SMTP account for password reset emails.
- Optional: a Google OAuth client ID for Google sign-in.
- Recommended: an alert webhook (Slack, Teams or an incident tool).

## First deployment

```bash
git clone <repository> /srv/dtu && cd /srv/dtu
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`. Every variable is explained in the file; the key ones are:

| Variable                           | Value                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                | `openssl rand -hex 32` (it is used in a URL, so keep it URL-safe)                                                                                     |
| `JWT_ACCESS_SECRET`, `CSRF_SECRET` | `openssl rand -base64 48`, two different values. Placeholder or weak values stop the API from starting.                                               |
| `FRONTEND_URL`, `CORS_ORIGINS`     | The public HTTPS URL, e.g. `https://tasks.example.com`                                                                                                |
| `COOKIE_SECURE`                    | `true` (required in production)                                                                                                                       |
| `TRUST_PROXY`                      | Number of proxies that add `X-Forwarded-For`: `2` for a TLS proxy in front of the bundled nginx. Must be correct for rate limiting and the audit log. |
| `SMTP_URL`, `MAIL_FROM`            | Your mail provider                                                                                                                                    |
| `ALERT_WEBHOOK_URL`                | Receives Excel sync failures and unexpected server errors                                                                                             |
| `WEB_BIND` / `WEB_PORT`            | `127.0.0.1` / `8080` when the TLS proxy runs on the same host                                                                                         |

Start the stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
docker compose -f docker-compose.prod.yml --env-file .env.production ps   # api, web, postgres: healthy
curl -fsS http://127.0.0.1:8080/api/health
```

`npm run prod:up` and `npm run prod:down` are shortcuts for the same commands.

### TLS reverse proxy

Example with Caddy, which obtains certificates automatically:

```caddy
tasks.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080
}
```

With nginx, use `proxy_pass http://127.0.0.1:8080;` and set `X-Forwarded-For $proxy_add_x_forwarded_for` and `X-Forwarded-Proto $scheme`. Keep `client_max_body_size` at 3 MB or more for profile pictures.

With either proxy, there are two hops in front of the API, so set `TRUST_PROXY=2`.

**Google sign-in:** add `https://tasks.example.com` to the OAuth client's **Authorized JavaScript origins**.

## Go-live checklist

- [ ] `.env.production` has real, unique secrets, is `chmod 600`, and is not in git.
- [ ] HTTPS works, and HTTP redirects to HTTPS. HSTS is sent by the app.
- [ ] `TRUST_PROXY` matches the number of proxies. To check: sign in with a wrong password, then confirm the IP in `audit_events` is your public IP, not a proxy's.
- [ ] `NODE_ENV=production`. The image sets it; never override it.
- [ ] Swagger is off (`/api/docs` returns 404) unless it is deliberately enabled.
- [ ] `SMTP_URL` is set, and a password reset email arrives.
- [ ] `ALERT_WEBHOOK_URL` is set, and a test alert arrives (see [Monitoring](#monitoring)).
- [ ] Nightly backups are scheduled and copied off-site, and one restore has been tested.
- [ ] Ports 5432 and 3000 are not reachable from outside. Only 443 (and 80 for redirects) is open.

## Database migrations

- Migrations live in `backend/prisma/migrations` and are applied by the `migrate` service on every `up`, before the API starts. If a migration fails, `up` stops with an error and the new API version is not started.
- Migrations are written to be backwards-compatible: additive columns with defaults, and backfills inside the migration.
- **Always back up before an upgrade** (see below).
- Check the state:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate npx --no-install prisma migrate status
```

## Upgrades and rollback

```bash
scripts/backup.sh                                   # 1. back up
git pull                                            # 2. new version (or set IMAGE_TAG for CI-built images)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait   # 3. migrate + restart
```

During step 3, the old API finishes its in-flight requests and Excel jobs before it stops (graceful shutdown, within 30 s). Expect a few seconds of unavailability, because one instance is replaced.

**Rollback:**

- If no migration ran, check out or tag the previous version and run `up` again.
- If a migration ran, restore the backup taken in step 1 with `scripts/restore.sh`, then start the previous version.

**CI-built images:** CI publishes `ghcr.io/<owner>/<repo>-{migrate,api,web}:<commit-sha>` for every commit on `main`. To deploy one without building, set `IMAGE_PREFIX=ghcr.io/<owner>/<repo>` and `IMAGE_TAG=<sha>`, then run `docker compose ... pull && docker compose ... up -d --wait`.

## Backup and recovery

| What           | How                                                                      | Notes                                            |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Database       | `pg_dump --format=custom` (a consistent snapshot; the API keeps running) | Contains all data and the audit log              |
| Workbook files | `tar.gz` of the `workbook-data` volume                                   | Can be rebuilt from the database, but saves time |
| Integrity      | `SHA256SUMS`, plus archive checks at backup time                         | Verified again before every restore              |

```bash
scripts/backup.sh                      # writes backups/<UTC timestamp>/; deletes backups older than 14 days
RETENTION_DAYS=30 scripts/backup.sh /mnt/backups
```

Schedule it nightly, and copy the backup folder off the server (object storage, another host):

```cron
15 2 * * * cd /srv/dtu && scripts/backup.sh >> backups/backup.log 2>&1
```

Backups contain personal data. Store them encrypted, with restricted access.

**Restore** (this replaces all current data):

```bash
scripts/restore.sh backups/20261108T021500Z            # asks you to type "restore"
```

The restore does the following:

1. Verifies the checksums.
2. Stops `api` and `web`.
3. Restores the database in one transaction.
4. Restores the files.
5. Marks every workbook for an Excel rebuild.
6. Starts the application. Newer migrations are applied if the backup is older than the code.

The rebuild guarantees that the files match the restored database. **Test a restore regularly**, for example monthly on a staging server.

**Point-in-time recovery:** nightly dumps can lose up to a day of changes. If that is too much, use a managed PostgreSQL with point-in-time recovery, or WAL archiving (e.g. pgBackRest). Then set `POSTGRES_*` / `DATABASE_URL` to the managed database and remove the `postgres` service.

## Health checks

| Endpoint               | Use                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` (web)   | nginx is up (container health check)                                                                                            |
| `GET /api/health/live` | The API process is up (container health check; liveness)                                                                        |
| `GET /api/health`      | Readiness: database reachable and workbook storage writable. Returns 503 with indicator statuses only; details are in the logs. |

Point your uptime monitor at `https://tasks.example.com/api/health`.

## Monitoring

- **Logs:** JSON, one object per line (`LOG_FORMAT=json`). Docker rotates them at 10 MB × 5 per container. Ship them to your log platform, e.g. with a Docker logging driver or an agent such as Vector or Fluent Bit. Useful fields:
  - `requestId`: also returned in the `X-Request-Id` header and in every error body, so users can quote it.
  - `event`: `http.request` (access log), `error.unexpected`, `excel_sync.job_failed`, `excel_sync.job_dead`, `alert`, `shutdown.*`.
  - `audit: true`: security events.
- **Alerts:** sent to `ALERT_WEBHOOK_URL` as JSON with a `text` field (Slack/Teams compatible):
  - `excel_sync_failed` (critical): a workbook stopped syncing after its retries.
  - `server_error` (critical): an unexpected exception, at most one per distinct error every 10 minutes.

  To test delivery, temporarily break a workbook file (see [Excel synchronisation](ARCHITECTURE.md#excel-synchronisation)), or watch for the first `server_error`.

- **Audit log queries** (inside the `postgres` container):

  ```sql
  -- Failed sign-ins in the last 24 hours, by IP
  SELECT ip, count(*) FROM audit_events
  WHERE event = 'auth.login' AND outcome = 'FAILURE' AND created_at > now() - interval '1 day'
  GROUP BY ip ORDER BY 2 DESC;

  -- Everything that happened to one account
  SELECT created_at, event, outcome, ip, details FROM audit_events
  WHERE user_id = '<uuid>' ORDER BY created_at;
  ```

  Retention: the table only accepts inserts. Delete old rows on a schedule if your policy requires it, e.g. `DELETE FROM audit_events WHERE created_at < now() - interval '1 year'`.

- **Excel sync health:** `SELECT status, count(*) FROM excel_sync_jobs GROUP BY status;`. `DEAD` jobs need a **Resync now** on the Workbooks page once the cause is fixed.

## Graceful shutdown

On `SIGTERM` (`docker compose stop`, deploys, host shutdown), the API shuts down in this order:

1. Logs `shutdown.started`.
2. Stops the Excel worker after its current jobs.
3. Stops accepting connections and finishes in-flight requests.
4. Closes the database pool and exits.

A 25-second safety timeout stays within the 30-second `stop_grace_period`. Queued Excel jobs are stored in the database and processed after the restart.

## Scaling

The default is one API instance, which is enough for hundreds of active users. Before running several instances:

- **Rate limits are kept in memory per instance.** Add a shared throttler store, such as Redis with `@nest-lab/throttler-storage-redis`, or limits will multiply.
- **Workbook storage** must be shared by all instances: a network filesystem, or a single API instance owning the volume.
- **The Excel worker is safe to run in every instance.** Jobs are claimed with `SKIP LOCKED`, and each workbook has a single writer through an advisory lock. Alternatively, run it only on dedicated instances (`EXCEL_SYNC_WORKER_ENABLED=false` elsewhere).

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. **quality:** format check, lint, typecheck, unit tests, builds, `npm audit --omit=dev --audit-level=high`.
2. **api-integration:** a PostgreSQL service, migrations, a schema drift check, and all API and database suites.
3. **browser:** the Playwright suite against production builds; the report is uploaded as an artifact.
4. **docker:** builds the images, starts the production stack, runs smoke and shutdown checks. On `main`, it publishes the images to GHCR.

Dependabot (`.github/dependabot.yml`) opens weekly update pull requests for npm, the Docker base images and the GitHub Actions.

**Deploying from CI** (optional): add a job that runs after `docker`, with an SSH key stored as a repository secret. On the server it runs `scripts/backup.sh`, then `IMAGE_TAG=<sha> docker compose ... pull`, then `up -d --wait`. Afterwards it runs the browser suite against the site as a smoke test: `E2E_BASE_URL=https://tasks.example.com npm run test:browser`. Protect it with a GitHub environment that requires approval.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API container restarts; log shows an environment error          | A variable is invalid; the message names it. Weak or placeholder secrets and `COOKIE_SECURE=false` are rejected in production. |
| `migrate` exits non-zero; API not started                       | Read `docker compose ... logs migrate`. Fix the cause, or restore the pre-upgrade backup.                                      |
| Everyone is rate-limited at once, or audit IPs are all the same | `TRUST_PROXY` is too low. Set it to the number of proxies in front of the API.                                                 |
| Users signed out right after signing in                         | The site is served over HTTP while `COOKIE_SECURE=true`. Serve it over HTTPS.                                                  |
| Google button missing or origin error                           | Set `GOOGLE_CLIENT_ID`, and add the site origin to the OAuth client.                                                           |
| "Excel update failed" on a workbook                             | Check `excel_sync.job_dead` in the logs (the full error is there), fix the storage cause, then **Resync now**.                 |
| `/api/health` returns 503                                       | Check `docker compose ... logs api` for the indicator that failed (database or workbook storage).                              |
