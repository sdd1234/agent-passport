#!/usr/bin/env bash
# Shared by installation and every browser test entry point.
PASSPORT_BROWSER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PLAYWRIGHT_BROWSERS_PATH="$PASSPORT_BROWSER_ROOT/.tools/playwright"
if [ -d "$PASSPORT_BROWSER_ROOT/.tools/browser-libs/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$PASSPORT_BROWSER_ROOT/.tools/browser-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
