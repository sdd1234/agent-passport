#!/usr/bin/env bash
set -euo pipefail
: "${1:?Usage: bash scripts/backup.sh /private/backup.dump [env-file]}"
umask 077
if [ -e "$1" ]; then echo 'Destination already exists' >&2; exit 1; fi
PASSPORT_BACKUP_TMP="$(mktemp "${1}.tmp.XXXXXX")"
trap 'rm -f "$PASSPORT_BACKUP_TMP"' EXIT
docker compose --env-file "${2:-.env}" -f infra/compose.production.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$PASSPORT_BACKUP_TMP"
mv "$PASSPORT_BACKUP_TMP" "$1"
echo 'Database backup saved. Keep the encryption key separately; never commit either file.'
