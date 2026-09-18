import { chromium, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
const browser = await chromium.launch();
const base = "http://localhost:5173";
const users = [];
const headers = { "X-Passport-Request": "1", Origin: base };
try {
  for (const name of ["sender", "receiver"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    const user = {
      context,
      page,
      username: `${name}${Date.now()}`,
      password: crypto.randomBytes(24).toString("base64url"),
      created: false,
    };
    users.push(user);
    await page.goto(base);
    await expect(
      page.getByRole("button", { name: "지갑으로 로그인" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByLabel("사용자 이름", { exact: true }).fill(user.username);
    await page.getByLabel("비밀번호", { exact: true }).fill(user.password);
    await page
      .getByRole("button", { name: "계정 만들기", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "복구 코드를 보관했습니다" }),
    ).toBeVisible();
    user.created = true;
    await page
      .getByRole("button", { name: "복구 코드를 보관했습니다" })
      .click();
  }
  const [sender, receiver] = users;
  const a = sender.page,
    b = receiver.page;
  await a
    .getByLabel("폴더 이름", { exact: true })
    .fill("OTP pairing verification");
  const response = a.waitForResponse(
    (r) => r.url().endsWith("/api/folders") && r.request().method() === "POST",
  );
  await a.getByRole("button", { name: "폴더 만들기", exact: true }).click();
  const folder = await (await response).json();
  await a
    .getByLabel("인수인계 문서", { exact: true })
    .fill("Code sharing handoff verified");
  await a.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(a.getByRole("status")).toHaveText("서버에 저장했습니다.");
  await a.getByRole("button", { name: "공유 코드 발급", exact: true }).click();
  let code = await a
    .getByLabel("발급된 공유 코드", { exact: true })
    .inputValue();
  await a.getByRole("button", { name: "코드 취소", exact: true }).click();
  await b.getByText("일회용 코드로 공유받기", { exact: true }).click();
  await b.getByLabel("받은 공유 코드", { exact: true }).fill(code);
  await b.getByRole("button", { name: "연결 요청", exact: true }).click();
  await expect(b.getByRole("alert")).toContainText("만료되었거나 취소");
  await a.getByRole("button", { name: "공유 코드 발급", exact: true }).click();
  code = await a.getByLabel("발급된 공유 코드", { exact: true }).inputValue();
  await b.getByLabel("받은 공유 코드", { exact: true }).fill(code);
  await b.getByRole("button", { name: "연결 요청", exact: true }).click();
  await expect(a.getByText(receiver.username, { exact: true })).toBeVisible();
  const before = await receiver.context.request.get(
    `${base}/api/folders/${folder.id}`,
  );
  expect(before.status()).toBe(403);
  await a
    .getByLabel("보내는 PC 코드 확인", { exact: true })
    .fill(code === "000000000000" ? "111111111111" : "000000000000");
  await a
    .getByRole("button", { name: "상대 확인 후 공유 연결", exact: true })
    .click();
  await expect(a.getByRole("alert")).toContainText("일치하지 않습니다");
  await a.getByLabel("보내는 PC 코드 확인", { exact: true }).fill(code);
  await a
    .getByRole("button", { name: "상대 확인 후 공유 연결", exact: true })
    .click();
  await expect(b.getByLabel("인수인계 문서", { exact: true })).toHaveValue(
    "Code sharing handoff verified",
  );
  await expect(b.getByLabel("인수인계 문서", { exact: true })).toBeDisabled();
  const replay = await receiver.context.request.post(
    `${base}/api/pairings/join`,
    { headers, data: { code } },
  );
  expect(replay.status()).toBe(409);
  await b.screenshot({
    path: "/tmp/passport-pairing-receiver.png",
    fullPage: true,
  });
  await a.getByRole("button", { name: "공유 철회", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "공유 철회", exact: true }),
  ).toHaveCount(0);
  const after = await receiver.context.request.get(
    `${base}/api/folders/${folder.id}`,
  );
  expect(after.status()).toBe(403);
  fs.writeFileSync(
    "docs/pairing-validation.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        environment:
          "PC service, persistent PostgreSQL, two isolated Chromium contexts",
        checks: [
          "no wallet login",
          "GUI signup of both accounts",
          "cancelled code denied",
          "receiver identity displayed",
          "no access before sender confirmation",
          "wrong sender code rejected",
          "both parties enter same code",
          "shared handoff visible with viewer restrictions",
          "single use",
          "revoke blocks access",
        ],
        limitations: [
          "Two browser sessions on one host; separate physical PCs and public network access not tested.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: PC GUI two-party code pairing, cancellation, incorrect code, restricted sharing, replay rejection, revocation",
  );
} finally {
  const failures = [];
  for (const user of [...users].reverse()) {
    if (user.created) {
      const result = await user.context.request.delete(`${base}/api/account`, {
        headers,
        data: { password: user.password, confirmation: "DELETE" },
      });
      if (!result.ok()) failures.push(result.status());
    }
  }
  await browser.close();
  if (failures.length)
    throw new Error(`Synthetic account cleanup failed: ${failures.join(",")}`);
}
