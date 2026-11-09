# syntax=docker/dockerfile:1
# Daily Task Update API. Build from the repository root (npm workspaces share one lockfile):
#   docker build -f backend/Dockerfile -t dtu-api .
#
# Targets:
#   runtime (default)  production API: compiled code + production dependencies, non-root
#   migrate            one-shot job that applies Prisma migrations (`prisma migrate deploy`)

ARG NODE_IMAGE=node:24-slim

# ---- dependencies (all, for building) ---------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY e2e/package.json e2e/package.json
# Install scripts are skipped here (prisma generate runs explicitly in the build stage).
RUN npm ci --workspace backend --include-workspace-root=false --ignore-scripts --no-audit --no-fund

# ---- build -----------------------------------------------------------------------------------
FROM deps AS build
COPY backend backend
# prisma7.config.ts reads DATABASE_URL; generating the client needs no real database.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build --workspace backend

# ---- migrations job ----------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app/backend
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ---- production dependencies only ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY e2e/package.json e2e/package.json
# Note: npm keeps the Prisma CLI here (a peer of @prisma/client); it is never executed at runtime.
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund \
  && mkdir -p backend/node_modules && npm cache clean --force

# ---- runtime -----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    LOG_FORMAT=json \
    PORT=3000 \
    WORKBOOK_STORAGE_DIR=/data/workbooks
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=prod-deps --chown=node:node /app/backend/node_modules backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --chown=node:node backend/package.json backend/package.json
# Workbook files live on a persistent volume mounted here.
RUN mkdir -p /data/workbooks && chown -R node:node /data
USER node
WORKDIR /app/backend
EXPOSE 3000
# Liveness only (the database is checked by /api/health, used for readiness).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'+(process.env.API_PREFIX||'api')+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Node runs as PID 1's child under `init: true` (compose) and handles SIGTERM gracefully.
CMD ["node", "dist/main.js"]
