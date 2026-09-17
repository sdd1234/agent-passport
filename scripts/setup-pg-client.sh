#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -x .tools/pg-client/root/usr/lib/postgresql/16/bin/pg_dump ]; then exit 0; fi
for cmd in apt-get dpkg-deb; do command -v "$cmd" >/dev/null || { echo 'PostgreSQL 16 client tools required. Install them and set PG_DUMP_BIN / PG_RESTORE_BIN.' >&2; exit 1; }; done
mkdir -p .tools/pg-client
cd .tools/pg-client
apt-get download postgresql-client-16 libpq5
for pkg in ./*.deb; do dpkg-deb -x "$pkg" root; done
