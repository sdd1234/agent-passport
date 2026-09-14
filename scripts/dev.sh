#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
if [ -f .env ]; then set -a; source .env; set +a; fi
mkdir -p .data
mvn -q -f apps/api/pom.xml spring-boot:run > .data/api.log 2>&1 &
PASSPORT_API_PID=$!
cleanup() { pkill -TERM -P "$PASSPORT_API_PID" 2>/dev/null || true; kill "$PASSPORT_API_PID" "${PASSPORT_WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --strictPort &
PASSPORT_WEB_PID=$!
printf 'Agent Passport: http://localhost:5173\nAPI log: %s/.data/api.log\n' "$PASSPORT_ROOT"
wait -n "$PASSPORT_API_PID" "$PASSPORT_WEB_PID"
