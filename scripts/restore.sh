#!/usr/bin/env bash
set -euo pipefail
: "${1:?Usage: PASSPORT_RESTORE_CONFIRM=restore bash scripts/restore.sh backup.dump [env-file]}"
if [ "${PASSPORT_RESTORE_CONFIRM:-}" != restore ]; then echo 'Set PASSPORT_RESTORE_CONFIRM=restore after stopping API/web and verifying the destination database.' >&2; exit 1; fi
docker compose --env-file "${2:-.env}" -f infra/compose.production.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction --exit-on-error' < "$1"
