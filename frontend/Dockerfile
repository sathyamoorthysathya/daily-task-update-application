# syntax=docker/dockerfile:1
# Daily Task Update web client: static build served by nginx, which also proxies /api to the API.
# Build from the repository root (npm workspaces share one lockfile):
#   docker build -f frontend/Dockerfile -t dtu-web .

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --workspace frontend --include-workspace-root=false --ignore-scripts --no-audit --no-fund
COPY frontend frontend
# Public build-time settings (never secrets: everything here ends up in the browser bundle).
# (The Google client ID is fetched from the API at runtime.)
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build --workspace frontend

# Unprivileged nginx: runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# Upstream API address (the compose service name by default).
ENV API_UPSTREAM=http://api:3000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
