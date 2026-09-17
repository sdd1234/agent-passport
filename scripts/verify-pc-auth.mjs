import { chromium, expect } from "@playwright/test";
import crypto from "node:crypto";
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const username = `auth${Date.now()}`;
const password = crypto.randomBytes(24).toString("base64url");
let created = false;
try {
  await page.goto("http://127.0.0.1:5173");
  await expect(page).toHaveURL("http://localhost:5173/");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("사용자 이름", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("short");
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("12~200자");
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "복구 코드를 보관했습니다" }),
  ).toBeVisible();
  created = true;
  await page.getByRole("button", { name: "복구 코드를 보관했습니다" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByLabel("사용자 이름", { exact: true }).fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password-123");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("올바르지 않습니다");
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.screenshot({
    path: "/tmp/passport-auth-verified.png",
    fullPage: true,
  });
  console.log(
    "PASS: alternate address redirect, signup validation, GUI signup, logout, invalid login feedback, GUI login, session after reload",
  );
} finally {
  if (created) {
    const response = await context.request.delete(
      "http://localhost:5173/api/account",
      {
        headers: { "X-Passport-Request": "1", Origin: "http://localhost:5173" },
        data: { password, confirmation: "DELETE" },
      },
    );
    if (!response.ok())
      throw new Error(`Test account cleanup failed: ${response.status()}`);
  }
  await browser.close();
}
