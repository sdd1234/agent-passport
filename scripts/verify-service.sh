#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
mkdir -p .data
npm run build
npm run test:importer
mvn -q -f apps/api/pom.xml package
node scripts/verify-service.mjs
