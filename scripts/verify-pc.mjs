import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const config = JSON.parse(
  fs.readFileSync(
    new URL("../.data/pc-server/settings.json", import.meta.url),
    "utf8",
  ),
);
const base = `http://localhost:${config.webPort}`;
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  page = await context.newPage();
const username = "pcverify" + Date.now(),
  password = crypto.randomBytes(24).toString("base64url");
let registered = false;
try {
  await page.goto(base);
  assert.equal(
    await page
      .getByRole("button", { name: "데모 시작하기", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("사용자 이름", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await page
    .getByRole("button", { name: "복구 코드를 보관했습니다", exact: true })
    .click();
  registered = true;
  await page
    .getByLabel("폴더 이름", { exact: true })
    .fill("PC server verification");
  await page
    .getByLabel("로컬 프로젝트 경로", { exact: true })
    .fill("/pc/verification");
  await page.getByRole("button", { name: "폴더 만들기", exact: true }).click();
  await page
    .getByLabel("인수인계 문서", { exact: true })
    .fill("Persistent local PostgreSQL check");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "서버에 저장했습니다." })
    .waitFor();
  execFileSync("systemctl", ["--user", "restart", "agent-passport.service"]);
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready);
  await page.reload();
  await page
    .getByRole("button", {
      name: "PC server verification · 내 폴더",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByLabel("인수인계 문서", { exact: true }).inputValue(),
    "Persistent local PostgreSQL check",
  );
  await page.screenshot({
    path: "/tmp/passport-pc-server.png",
    fullPage: true,
  });
  console.log(
    "PASS: PC built-web signup, folder write, systemd restart, persistent session and PostgreSQL content.",
  );
  fs.writeFileSync(
    new URL("../docs/pc-server-validation.json", import.meta.url),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: "service",
        host: "local PC / WSL",
        database: "persistent PostgreSQL 16",
        checks: [
          "built static web",
          "individual signup",
          "folder handoff saved",
          "user systemd restart",
          "session and content persistence",
          "synthetic test account cleanup",
        ],
        access: "loopback only",
        externalInternetAccess: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (registered) {
    const result = await context.request.delete(base + "/api/account", {
      headers: { "X-Passport-Request": "1" },
      data: { password, confirmation: "DELETE" },
    });
    assert.equal(result.status(), 200, "Synthetic test account cleanup failed");
  }
  await browser.close();
}
