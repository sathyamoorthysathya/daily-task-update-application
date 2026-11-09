#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the production stack.
#
#   scripts/restore.sh backups/20261108T021500Z [--yes]
#
# This REPLACES the current database and workbook files. Steps:
#   1. verify checksums   2. stop api + web   3. restore the database (single transaction)
#   4. restore workbook files   5. mark every workbook for an Excel rebuild
#   6. start api + web (the migrate job first applies migrations newer than the backup)
# PostgreSQL is the source of truth: step 5 makes the API rebuild every .xlsx file from the
# restored data, so files and database are consistent even if the backup parts differ slightly.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep container paths as they are

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-.env.production}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.22}
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
abs() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

DIR=${1:?usage: scripts/restore.sh <backup-dir> [--yes]}
[ -f "$DIR/database.dump" ] || { echo "no database.dump in $DIR" >&2; exit 1; }

echo "[restore] verifying checksums"
( cd "$DIR" && sha256sum -c SHA256SUMS )

if [ "${2:-}" != "--yes" ]; then
  read -r -p "This replaces ALL current data with $DIR. Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
fi

echo "[restore] stopping api and web"
compose stop web api
compose up -d --wait postgres
PG=$(compose ps -q postgres)
API=$(compose ps -aq api)
VOLUME=$(docker inspect "$API" \
  --format '{{range .Mounts}}{{if eq .Destination "/data/workbooks"}}{{.Name}}{{end}}{{end}}')

echo "[restore] database"
docker cp "$DIR/database.dump" "$PG:/tmp/restore.dump"
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error /tmp/restore.dump; status=$?; rm -f /tmp/restore.dump; exit $status'

if [ -f "$DIR/workbooks.tar.gz" ]; then
  echo "[restore] workbook files ($VOLUME)"
  # Files belong to the API's user (node, uid 1000).
  docker run --rm -v "$VOLUME:/data" -v "$(abs "$DIR"):/backup:ro" "$HELPER_IMAGE" \
    sh -c 'find /data -mindepth 1 -delete && tar -xzf /backup/workbooks.tar.gz -C /data && chown -R 1000:1000 /data'
fi

echo "[restore] scheduling an Excel rebuild of every workbook"
compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE workbooks SET synced_version = 0, sync_error = NULL"'

echo "[restore] starting the application"
# The api service depends on the migrate job, which runs first and must succeed.
compose up -d --wait api web
echo "[restore] done"
