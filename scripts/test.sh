#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
npm run build
mvn -q -f apps/api/pom.xml test
npm run test:contracts
if curl -fsS http://127.0.0.1:8080/api/health >/dev/null && curl -fsS http://localhost:5173 >/dev/null; then
  if [ -d .tools/browser-libs/usr/lib/x86_64-linux-gnu ]; then export LD_LIBRARY_PATH="$PASSPORT_ROOT/.tools/browser-libs/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"; fi
  npm run test:e2e
  node scripts/test-mcp.mjs
else
  printf 'UI/MCP tests require npm run dev in another terminal.\n'
fi
