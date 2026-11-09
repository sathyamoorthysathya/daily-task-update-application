# Daily Task Update

A web application for recording daily work as tasks. Every task is saved in PostgreSQL and kept in sync with your own Excel workbooks (`.xlsx`).

- **Accounts:** email + password or Google sign-in, with a profile and profile picture.
- **Excel workbooks:** create several, set a default, download them at any time.
- **Daily tasks:** auto-numbered and dated, with a status. The same task can get an entry on several days, and the app asks what to do when a name already exists.
- **Task management:** search, filters, sorting, pagination, editing, safe delete and a full change history.
- **Dashboard:** key figures, a 14-day activity chart, tasks by status, recent updates and workbook progress.
- **Reliability and security:** Excel files are updated in the background with retries and recovery, plus secure sessions, rate limits and an audit log.

| Layer    | Technology                                                                   |
| -------- | ---------------------------------------------------------------------------- |
| Frontend | React 19, TypeScript 6, Vite 8, React Router                                 |
| Backend  | NestJS 12 (ESM), TypeScript 6, Prisma 7, Zod, ExcelJS, Swagger               |
| Database | PostgreSQL 18                                                                |
| Tooling  | npm workspaces, ESLint, Prettier, Vitest, Playwright, Docker, GitHub Actions |

---

## Contents

- [Run the project](#run-the-project)
  - [Option 1: Locally](#option-1-locally-nodejs--postgresql)
  - [Option 2: Docker](#option-2-docker-one-command)
- [Google sign-in (optional)](#google-sign-in-optional)
- [Commands](#commands)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

---

## Run the project

There are two ways to run the app on your computer. Both give you the full application: the web client, the API and the database.

|                   | Option 1: Locally                                                  | Option 2: Docker                 |
| ----------------- | ------------------------------------------------------------------ | -------------------------------- |
| You need          | Node.js 22.12+ and PostgreSQL 18 (or Docker for the database only) | Docker Desktop only              |
| Start             | `npm run dev`                                                      | `npm run docker:up`              |
| App               | http://localhost:5173                                              | http://localhost:8080            |
| API documentation | http://localhost:3000/api/docs                                     | http://localhost:8080/api/docs   |
| Code changes      | Reload instantly (best for development)                            | Rebuild with `npm run docker:up` |

### Option 1: Locally (Node.js + PostgreSQL)

**One-time setup.** Commands are shown for PowerShell; on macOS or Linux use `cp` instead of `Copy-Item`.

1. **Install** Node.js 22.12 or newer, then install the project's packages:

   ```powershell
   npm install
   ```

2. **Create the settings files:**

   ```powershell
   Copy-Item backend/.env.example backend/.env
   Copy-Item frontend/.env.example frontend/.env   # optional; the defaults work
   ```

   In `backend/.env`, replace `JWT_ACCESS_SECRET` and `CSRF_SECRET` with two different random values. You can generate each with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

3. **Prepare the database.** Choose one:
   - **PostgreSQL installed on your computer** (for example `winget install PostgreSQL.PostgreSQL.18`). Create the app's user and database once, entering the `postgres` password chosen during installation:

     ```powershell
     & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f scripts/setup-local-postgres.sql
     ```

     `backend/.env` already points to it (port 5432).

   - **PostgreSQL in Docker:** run `npm run db:up`, then change the port in `DATABASE_URL` in `backend/.env` from `5432` to `5433`.

4. **Create the tables:**

   ```powershell
   npm run prisma:deploy -w backend
   ```

**Every time:**

1. Make sure the database is running:
   - Windows service: `Get-Service postgresql-x64-18` should show **Running**. If it doesn't, run `Start-Service postgresql-x64-18` as Administrator.
   - Docker database: `npm run db:up`.
2. Start the API and the web client together, **from the project folder** (not from `backend/`):

   ```powershell
   npm run dev
   ```

   Wait for `API listening on http://localhost:3000/api` and `Local: http://localhost:5173/`.

3. Open **http://localhost:5173**, create an account and your first Excel workbook.

Stop with **Ctrl + C**. You can also run the two apps in separate terminals: `npm run dev:backend` and `npm run dev:frontend`.

> Password reset emails are not sent locally. The reset link is printed in the `npm run dev` terminal.

### Option 2: Docker (one command)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running). No Node.js or PostgreSQL installation is needed.

```powershell
npm run docker:up          # or: docker compose up -d --build --wait
```

The first build takes a few minutes. When it finishes, open **http://localhost:8080**.

The command starts four containers:

- **postgres:** the database, with its data kept in a Docker volume;
- **migrate:** creates or updates the tables, then exits;
- **api:** the NestJS API and the Excel worker, with workbook files kept in a Docker volume;
- **web:** nginx serving the web app and forwarding `/api` to the API.

| Task                                     | Command                                   |
| ---------------------------------------- | ----------------------------------------- |
| See the logs (e.g. password reset links) | `npm run docker:logs`                     |
| Stop (data is kept)                      | `npm run docker:down`                     |
| Stop and delete all data                 | `docker compose down -v`                  |
| Apply code changes                       | `npm run docker:up` (rebuilds the images) |

- **No configuration is needed.** To change ports, credentials or secrets, or to enable Google sign-in, copy `.env.example` to `.env` in the project folder and edit it.
- **Ports:** the Docker database uses host port **5433**, so it never conflicts with a PostgreSQL installed on your computer (5432). Both options can run at the same time.
- **Production:** these defaults are for your own computer. For servers, use `docker-compose.prod.yml` and follow the [deployment guide](docs/DEPLOYMENT.md).

---

## Google sign-in (optional)

The **Continue with Google** button appears on the Sign in and Create account pages once a Google Client ID is configured.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Open **Google Auth Platform** and click **Get started**:
   - **App name:** `Daily Task Update`
   - **Support email:** your email
   - **Audience:** **External**
   - **Contact email:** your email
3. Under **Audience → Test users**, add the Google accounts that will sign in.
4. Under **Clients**, choose **Create client**:
   - **Type:** Web application
   - **Authorized JavaScript origins:** `http://localhost`, `http://localhost:5173` and, for Docker, `http://localhost:8080`
   - **Redirect URIs:** none
5. Copy the **Client ID** (ending in `.apps.googleusercontent.com`):
   - **Option 1:** set `GOOGLE_CLIENT_ID=...` in `backend/.env` and restart `npm run dev`.
   - **Option 2:** set `GOOGLE_CLIENT_ID=...` in the root `.env` and run `npm run docker:up`.

You never need the client secret. Signing in with Google using the email of an existing account links the two accounts. See [Google sign-in](docs/ARCHITECTURE.md#google-sign-in) for how this works.

---

## Commands

Run these from the project folder.

| Command                                             | What it does                                                  |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                                       | Start the API (port 3000) and the web client (port 5173)      |
| `npm run dev:backend` / `dev:frontend`              | Start one of them                                             |
| `npm run docker:up` / `docker:down` / `docker:logs` | The whole app in Docker                                       |
| `npm run db:up` / `db:down` / `db:logs`             | Only the database in Docker (port 5433)                       |
| `npm run build`                                     | Production build of both apps                                 |
| `npm run prisma:deploy -w backend`                  | Apply database migrations                                     |
| `npm run prisma:studio -w backend`                  | Browse the database in the browser                            |
| `npm run prod:up` / `prod:down`                     | Production stack (see [deployment guide](docs/DEPLOYMENT.md)) |
| `npm run lint` / `typecheck`                        | ESLint / strict TypeScript checks                             |
| `npm run format` / `format:check`                   | Prettier                                                      |
| `npm run verify`                                    | Format check, lint, typecheck, unit tests and builds          |

---

## Testing

| Command                | Tests                                                                    | Needs                             |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| `npm run test`         | Unit and component tests (backend + frontend)                            | nothing                           |
| `npm run test:e2e`     | API, database, authentication, Excel sync and security tests             | PostgreSQL, migrations applied    |
| `npm run test:browser` | Playwright tests in a real browser (starts its own servers on 3100/4174) | PostgreSQL; a browser (see below) |

- **Browser for Playwright:** run `npx playwright install chromium` once, or use an installed browser with `$env:PW_CHANNEL='msedge'`.
- **Testing a running deployment:** set `$env:E2E_BASE_URL='http://localhost:8080'` (or any URL) to run the browser tests against it.
- **Stop `npm run dev` first** before `test:e2e` and `test:browser`, because its background Excel worker would also pick up the tests' jobs.

Results and coverage are documented in the [testing report](docs/TESTING_REPORT.md).

---

## Project structure

```
.
├── backend/                     NestJS API
│   ├── prisma/                  Database schema and migrations
│   ├── src/
│   │   ├── main.ts, app.*.ts    Startup, root module, HTTP setup (headers, CORS, cookies)
│   │   ├── config/              Settings schema (validated at startup)
│   │   ├── common/              Error filter, validation, rate limits, monitoring and audit log
│   │   ├── database/            Prisma service
│   │   └── modules/             auth, users (profile), workbooks (+ Excel sync), tasks, mail, health
│   ├── test/                    API and database tests
│   └── Dockerfile               API image and migration job
├── frontend/                    React web client
│   ├── src/
│   │   ├── app/                 Routes
│   │   ├── components/          Layout (sidebar, top bar), form fields, icons
│   │   ├── features/            auth, dashboard, tasks, workbooks, profile, health
│   │   └── lib/api/             HTTP client (cookies, CSRF, session refresh)
│   ├── nginx/                   Web server configuration (Docker)
│   └── Dockerfile               Web image
├── e2e/                         Playwright browser tests
├── docs/                        Architecture, configuration, deployment, security, testing
├── scripts/                     Local database setup, backup and restore
├── docker-compose.yml           Option 2: the whole app with Docker
├── docker-compose.prod.yml      Production stack
└── .github/                     CI/CD workflow and Dependabot
```

New features go in `backend/src/modules/<feature>/` and `frontend/src/features/<feature>/`.

---

## Documentation

| Document                                          | Contents                                                   |
| ------------------------------------------------- | ---------------------------------------------------------- |
| [Architecture and features](docs/ARCHITECTURE.md) | How each feature works, data model, API endpoints          |
| [Configuration](docs/CONFIGURATION.md)            | Every setting in the `.env` files                          |
| [Deployment guide](docs/DEPLOYMENT.md)            | Production with Docker: TLS, backups, upgrades, monitoring |
| [Security audit](docs/SECURITY_AUDIT.md)          | Security review, findings and fixes                        |
| [Testing report](docs/TESTING_REPORT.md)          | Test suites, results and coverage                          |

---

## Troubleshooting

| Problem                                              | Solution                                                                                                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing script: "dev"`                              | Run the command from the project folder, not from `backend/` or `frontend/`.                                                                                                                          |
| `Can't reach database server` / `ECONNREFUSED`       | The database isn't running (step 1 of "Every time"), or the port in `DATABASE_URL` is wrong (5432 local, 5433 Docker).                                                                                |
| `password authentication failed for user "dtu_user"` | Run `scripts/setup-local-postgres.sql` once (Option 1, step 3).                                                                                                                                       |
| `Port 3000 / 5173 / 8080 is already in use`          | Another copy is still running. Stop it (Ctrl + C, or `npm run docker:down`).                                                                                                                          |
| API stops with an environment error                  | A value in `backend/.env` is invalid; the message names it. Compare with `backend/.env.example`.                                                                                                      |
| `Cannot find module '../generated/prisma/client.js'` | Run `npm run prisma:generate -w backend`.                                                                                                                                                             |
| `failed to connect to the docker API`                | Start Docker Desktop and try again.                                                                                                                                                                   |
| "Continue with Google" is missing                    | `GOOGLE_CLIENT_ID` is not set. See [Google sign-in](#google-sign-in-optional).                                                                                                                        |
| Google shows an origin error or "Access blocked"     | Add the page's address to **Authorized JavaScript origins**, and your account under **Test users**.                                                                                                   |
| `429 Too many attempts`                              | A rate limit was hit; wait for the time in the message.                                                                                                                                               |
| "Excel update retrying" / "Excel update failed"      | Your tasks are saved; writing the file failed. Check the API log (`excel_sync.job_failed`), fix the cause (usually a locked file or a storage folder that isn't writable), then click **Resync now**. |
| "Updating Excel…" never finishes                     | The Excel worker isn't running: check `EXCEL_SYNC_WORKER_ENABLED`.                                                                                                                                    |
