#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/browser-env.sh
npx playwright install chromium
# Ubuntu/WSL minimal installs commonly omit NSS/NSPR. Keep packages local.
if command -v apt-get >/dev/null && command -v dpkg-deb >/dev/null; then
  mkdir -p .tools/browser-libs
  (
    cd .tools/browser-libs
    apt-get download libnspr4 libnss3
    for package in ./*.deb; do dpkg-deb -x "$package" .; done
    rm ./*.deb
  )
fi
source scripts/browser-env.sh
# Installation is successful only when the installed browser can actually run.
node --input-type=module - <<'JS'
import { chromium } from '@playwright/test';
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Agent Passport</h1>');
    if (await page.locator('h1').textContent() !== 'Agent Passport') {
      throw new Error('Browser smoke check failed');
    }
  } finally {
    await browser.close();
  }
  console.log('PASS: Chromium launch and page rendering');
} catch (error) {
  console.error(error.message);
  console.error('Browser OS dependencies are missing. Run npx playwright install-deps chromium, then bash scripts/setup.sh again.');
  process.exitCode = 1;
}
JS
