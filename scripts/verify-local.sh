#!/usr/bin/env bash
# Reproduce demo verification without reading .env or using an existing database/server.
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
export PORT="${VERIFY_API_PORT:-18082}"
export WEB_PORT="${VERIFY_WEB_PORT:-15174}"
export PASSPORT_API_URL="http://127.0.0.1:$PORT"
export PASSPORT_WEB_URL="http://localhost:$WEB_PORT"
export APP_ORIGIN="$PASSPORT_WEB_URL"
export APP_MODE=demo SEARCH_MODE=lexical COOKIE_SECURE=false
export OPENAI_API_KEY= ANTHROPIC_API_KEY= REGISTRY_ADDRESS=
node --input-type=module - <<'JS'
import net from 'node:net';
for (const port of [process.env.PORT, process.env.WEB_PORT]) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(Number(port), '127.0.0.1', () => server.close(resolve));
  });
}
JS
mkdir -p .data
PASSPORT_VERIFY_DIR="$(mktemp -d "$PASSPORT_ROOT/.data/verify-XXXXXX")"
export DATABASE_URL="jdbc:h2:file:$PASSPORT_VERIFY_DIR/passport;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE"
export DATABASE_USER=sa DATABASE_PASSWORD=
export MEMORY_ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
cleanup() {
  for pid in "${PASSPORT_API_PID:-}" "${PASSPORT_WEB_PID:-}"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
npm run build
mvn -q -f apps/api/pom.xml package
npm run test:contracts
java -jar apps/api/target/api-0.1.0.jar > "$PASSPORT_VERIFY_DIR/api.log" 2>&1 &
PASSPORT_API_PID=$!
node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --strictPort > "$PASSPORT_VERIFY_DIR/web.log" 2>&1 &
PASSPORT_WEB_PID=$!
for attempt in {1..60}; do
  kill -0 "$PASSPORT_API_PID" "$PASSPORT_WEB_PID" 2>/dev/null || { cat "$PASSPORT_VERIFY_DIR"/*.log; exit 1; }
  if curl -fsS "$PASSPORT_API_URL/api/health" >/dev/null 2>&1 && curl -fsS "$PASSPORT_WEB_URL" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "$PASSPORT_API_URL/api/health" >/dev/null
npm run test:e2e
npm run test:mcp
printf 'PASS: build, Java, contracts, browser, MCP. Isolated logs/DB: %s\n' "$PASSPORT_VERIFY_DIR"
