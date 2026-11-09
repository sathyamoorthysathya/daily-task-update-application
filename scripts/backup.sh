#!/usr/bin/env bash
# Backs up the production stack: the PostgreSQL database (custom-format pg_dump) and the
# workbook files volume, with a SHA-256 manifest.
#
#   scripts/backup.sh [backup-root]          (default: ./backups)
#
# Environment: COMPOSE_FILE (default docker-compose.prod.yml), ENV_FILE (default .env.production),
#              RETENTION_DAYS (delete backups older than this; default 14, 0 = keep all),
#              HELPER_IMAGE (image used to read the files volume; default alpine:3.22).
# Schedule it (e.g. cron: 15 2 * * * cd /srv/dtu && scripts/backup.sh >> backups/backup.log 2>&1)
# and copy the backup root to off-site storage.
#
# Files are copied with `docker cp` / a volume mount, never streamed through stdout (binary
# streams through `docker compose run/exec` can be truncated).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep container paths as they are

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-.env.production}
RETENTION_DAYS=${RETENTION_DAYS:-14}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.22}
ROOT=${1:-backups}
compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
abs() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR="$ROOT/$STAMP"
umask 077
mkdir -p "$DIR"

PG=$(compose ps -q postgres)
API=$(compose ps -aq api)
[ -n "$PG" ] || { echo "[backup] the postgres service is not running" >&2; exit 1; }
[ -n "$API" ] || { echo "[backup] the api container does not exist" >&2; exit 1; }
VOLUME=$(docker inspect "$API" \
  --format '{{range .Mounts}}{{if eq .Destination "/data/workbooks"}}{{.Name}}{{end}}{{end}}')

echo "[backup] database -> $DIR/database.dump"
# pg_dump takes a consistent snapshot; the API keeps running.
compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --compress=6 -f /tmp/backup.dump'
docker cp "$PG:/tmp/backup.dump" "$DIR/database.dump"
compose exec -T postgres sh -c 'pg_restore --list /tmp/backup.dump > /dev/null && rm /tmp/backup.dump'

echo "[backup] workbook files ($VOLUME) -> $DIR/workbooks.tar.gz"
docker run --rm -v "$VOLUME:/data:ro" -v "$(abs "$DIR"):/backup" "$HELPER_IMAGE" \
  sh -c 'tar -czf /backup/workbooks.tar.gz -C /data . && tar -tzf /backup/workbooks.tar.gz > /dev/null'

( cd "$DIR" && sha256sum database.dump workbooks.tar.gz > SHA256SUMS )
echo "[backup] done: $DIR ($(du -sh "$DIR" | cut -f1))"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" \
    -print -exec rm -rf {} + | sed 's/^/[backup] removed old backup: /'
fi
