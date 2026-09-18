import { test, expect } from "@playwright/test";
test("project folder handoff survives reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "데모 시작하기" }).click();
  await page
    .getByRole("button", { name: "프로젝트 · 인수인계", exact: true })
    .click();
  const name = `handoff-${Date.now()}`;
  await page.getByText("새 폴더", { exact: true }).click();
  await page.getByLabel("폴더 이름", { exact: true }).fill(name);
  await page.getByRole("button", { name: "폴더 만들기", exact: true }).click();
  await page.getByText("Claude·Codex 협업 연결", { exact: true }).click();
  for (const provider of ["claude", "codex"]) {
    await page.getByLabel("새 연결", { exact: true }).selectOption(provider);
    await page
      .getByRole("button", { name: "연결 키 발급", exact: true })
      .click();
    await expect(
      page.getByLabel("연결 키 · 한 번만 표시", { exact: true }),
    ).not.toHaveValue("");
    await expect(
      page.getByLabel(provider === "claude" ? "Claude 협업" : "Codex 협업", {
        exact: true,
      }),
    ).toHaveValue("3");
    await page
      .getByRole("button", { name: "키를 보관했습니다", exact: true })
      .click();
  }
  await page.getByText("Claude·Codex 협업 연결", { exact: true }).click();
  await page.getByText("작업 추가", { exact: true }).click();
  await page.getByLabel("작업 제목", { exact: true }).fill("협업 UI 구현");
  await page.getByLabel("작업 영역", { exact: true }).fill("apps/web");
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  await page.locator(".collaboration-task > summary").click();
  await page.getByRole("button", { name: "내가 맡기", exact: true }).click();
  await page
    .getByLabel("진행 보고", { exact: true })
    .fill("화면 구현 완료. API 연결을 다음 담당자에게 전달.");
  await page.getByRole("button", { name: "작업 완료", exact: true }).click();
  await expect(page.locator(".collaboration-task .timeline-badge")).toHaveText(
    "완료",
  );
  await page
    .getByRole("button", { name: "최근 진행 이력", exact: true })
    .click();
  await expect(page.locator(".collaboration-task")).toContainText(
    "다음 담당자에게 전달",
  );
  await page.getByText("진행 상황·인수인계", { exact: true }).click();
  await page
    .getByLabel("인수인계 문서", { exact: true })
    .fill("진행: 폴더 API 완료\n다음: 기억 가져오기");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("서버에 저장했습니다.");
  await page.reload();
  await page
    .getByRole("button", { name: "프로젝트 · 인수인계", exact: true })
    .click();
  await page
    .getByRole("button", { name: `${name} · 내 폴더`, exact: true })
    .click();
  await expect(page.locator(".collaboration-task .timeline-badge")).toHaveText(
    "완료",
  );
  await page.getByText("진행 상황·인수인계 · 작성됨", { exact: true }).click();
  await expect(page.getByLabel("인수인계 문서", { exact: true })).toHaveValue(
    "진행: 폴더 API 완료\n다음: 기억 가져오기",
  );
  await page.getByLabel("폴더 옵션", { exact: true }).click();
  await page.getByLabel("이름", { exact: true }).fill(name + " renamed");
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: name + " renamed", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "내 폴더", exact: true }).click();
  await expect(page.locator(".drive-grid")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: name + " renamed · 내 폴더",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel(name + " renamed 옵션", { exact: true }).click();
  await page
    .getByRole("button", { name: "이름 변경·관리", exact: true })
    .click();
  await expect(page.getByLabel("이름", { exact: true })).toBeVisible();
});
