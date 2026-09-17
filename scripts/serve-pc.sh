#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
exec node scripts/serve-pc.mjs
