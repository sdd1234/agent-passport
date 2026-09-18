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
  await page.getByText("진행 상황·인수인계 · 작성됨", { exact: true }).click();
  await expect(page.getByLabel("인수인계 문서", { exact: true })).toHaveValue(
    "진행: 폴더 API 완료\n다음: 기억 가져오기",
  );
});
