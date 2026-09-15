#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/browser-env.sh"
cd "$PASSPORT_BROWSER_ROOT"
exec node node_modules/@playwright/test/cli.js test "$@"
