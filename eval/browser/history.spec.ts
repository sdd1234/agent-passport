import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
test("shared edit, owner rollback, permission changes and export copy through GUI", async ({
  browser,
  baseURL,
}) => {
  const ownerContext = await browser.newContext({ baseURL }),
    guestContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage(),
    guest = await guestContext.newPage();
  const call = async (
    ctx: any,
    url: string,
    body?: unknown,
    method?: string,
  ) => {
    const r = await ctx.request.fetch("/api" + url, {
      method: method || (body ? "POST" : "GET"),
      headers: { "X-Passport-Request": "1" },
      ...(body ? { data: body } : {}),
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  try {
    const suffix = Date.now();
    await call(ownerContext, "/account/register", {
      username: `history-owner-${suffix}`,
      password: "test-history-password-123",
    });
    const gu = await call(guestContext, "/account/register", {
      username: `history-editor-${suffix}`,
      password: "test-history-password-123",
    });
    const folder = await call(ownerContext, "/folders", {
      name: "History fixture",
      projectPath: "",
    });
    await call(ownerContext, `/folders/${folder.id}/entries`, {
      title: "Shared decision",
      content: "원래 결정: PostgreSQL을 사용하기로 했습니다.",
      source: "fixture",
      kind: "decision",
      sourceKey: "history-fixture",
    });
    const pair = await call(ownerContext, "/pairings", {
      folderId: folder.id,
      role: "editor",
    });
    await call(guestContext, "/pairings/join", { code: pair.code });
    await call(ownerContext, `/pairings/${pair.id}/confirm`, {
      code: pair.code,
    });
    await guest.goto("/");
    await guest
      .getByRole("button", {
        name: "History fixture · 공유 · 편집",
        exact: true,
      })
      .click();
    await guest.getByText("진행 상황·인수인계", { exact: true }).click();
    await guest
      .getByLabel("인수인계 문서", { exact: true })
      .fill("공동작업자가 변경한 인수인계");
    await guest.getByRole("button", { name: "변경 저장", exact: true }).click();
    await expect(
      guest.getByText("서버에 저장했습니다.", { exact: true }),
    ).toBeVisible();
    await owner.goto("/");
    await owner
      .getByRole("button", { name: "History fixture · 내 폴더", exact: true })
      .click();
    await owner.getByText("변경 이력 · 복원", { exact: true }).click();
    await owner
      .locator(".history-list button")
      .filter({ hasText: "폴더 · 수정" })
      .first()
      .click();
    await expect(owner.locator(".history-detail")).toContainText(
      "공동작업자가 변경한 인수인계",
    );
    await expect(owner.locator(".history-detail")).toContainText(
      `history-editor-${suffix}`,
    );
    owner.on("dialog", (d) => d.accept());
    await owner
      .getByRole("button", { name: "변경 전으로 복원", exact: true })
      .click();
    await expect(owner.locator(".history-list")).toContainText(
      "이전 상태 복원",
    );
    await owner.getByText("진행 상황·인수인계", { exact: true }).click();
    await expect(
      owner.getByLabel("인수인계 문서", { exact: true }),
    ).toHaveValue("");
    await owner
      .getByRole("button", { name: "공유 · 권한 관리", exact: true })
      .click();
    await owner
      .getByLabel(`history-editor-${suffix} 공유 권한`, { exact: true })
      .selectOption("viewer");
    await expect(
      owner.getByLabel(`history-editor-${suffix} 공유 권한`, { exact: true }),
    ).toHaveValue("viewer");
    await guest.reload();
    await guest
      .getByRole("button", {
        name: "History fixture · 공유 · 읽기",
        exact: true,
      })
      .click();
    await guest.getByText("변경 이력 · 복원", { exact: true }).click();
    await guest.locator(".history-list button").first().click();
    await expect(
      guest.getByRole("button", { name: "변경 전으로 복원", exact: true }),
    ).toHaveCount(0);
    const downloadPromise = owner.waitForEvent("download");
    await owner
      .getByRole("button", { name: "EXPORT · 사본 공유", exact: true })
      .click();
    const download = await downloadPromise;
    const file = await download.path();
    expect(file).toBeTruthy();
    await guest.getByRole("button", { name: "내 폴더", exact: true }).click();
    await guest.locator(".drive-import > summary").click();
    await guest
      .getByLabel("가져오기 파일")
      .setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/json",
        buffer: await readFile(file!),
      });
    await expect(
      guest.getByText("비공개 사본으로 가져왔습니다.", { exact: false }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", {
        name: "History fixture · 내 폴더",
        exact: true,
      }),
    ).toBeVisible();
    const own = await call(guestContext, "/folders");
    expect(own.filter((f: any) => f.role === "owner")).toHaveLength(1);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
