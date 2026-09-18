import { test, expect } from "@playwright/test";
test("two accounts import, approve, share and revoke project context", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const owner = await a.newPage(),
    guest = await b.newPage();
  try {
    const suffix = Date.now().toString();
    for (const [page, name] of [
      [owner, "owner" + suffix],
      [guest, "guest" + suffix],
    ] as const) {
      await page.goto("/");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await page.getByLabel("사용자 이름", { exact: true }).fill(name);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill("browser-test-password-123");
      await page
        .getByRole("button", { name: "계정 만들기", exact: true })
        .click();
      await expect(
        page.getByText("복구 코드는 한 번만 표시됩니다.", { exact: false }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "복구 코드를 보관했습니다", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "프로젝트 · 인수인계." }),
      ).toBeVisible();
    }
    await owner.getByLabel("폴더 이름", { exact: true }).fill("Shared project");
    await owner
      .getByLabel("로컬 프로젝트 경로", { exact: true })
      .fill("/work/browser-project");
    await owner
      .getByRole("button", { name: "폴더 만들기", exact: true })
      .click();
    await owner
      .getByLabel("인수인계 문서", { exact: true })
      .fill("구현 완료: 계정과 폴더\n다음: 디자인 검토");
    await owner.getByRole("button", { name: "변경 저장", exact: true }).click();
    await expect(owner.getByRole("status")).toHaveText("서버에 저장했습니다.");
    await owner.getByText("기존 기억 가져오기", { exact: true }).click();
    await owner
      .getByLabel("기본 대상 폴더")
      .selectOption({ label: "Shared project" });
    await owner.getByLabel("가져오기 파일").setInputFiles({
      name: "passport-import.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              title: "Imported decision",
              content: "Choose PostgreSQL",
              source: "fixture.md",
              kind: "decision",
              projectName: "Shared project",
              projectPath: "/work/browser-project",
            },
          ],
        }),
      ),
    });
    await owner
      .getByText("Imported decision · Shared project", { exact: true })
      .click();
    await owner.getByLabel("이 항목 가져오기", { exact: false }).check();
    await owner
      .getByRole("button", { name: "검토한 항목 서버에 저장", exact: true })
      .click();
    await expect(
      owner.getByText("1개를 검토 대기 상태로 저장했습니다.", { exact: false }),
    ).toBeVisible();
    await owner
      .getByRole("button", {
        name: "Imported decision decision · 검토 대기 · v1",
        exact: false,
      })
      .click();
    await owner.getByRole("button", { name: "기억 승인", exact: true }).click();
    await expect(
      owner.getByRole("button", {
        name: "Imported decision decision · 승인됨 · v2",
        exact: false,
      }),
    ).toBeVisible();
    await owner.screenshot({
      path: "docs/service-projects.png",
      fullPage: true,
    });
    await owner
      .getByRole("button", { name: "공유 코드 발급", exact: true })
      .click();
    const code = await owner
      .getByLabel("발급된 공유 코드", { exact: true })
      .inputValue();
    await guest.getByText("일회용 코드로 공유받기", { exact: true }).click();
    await guest.getByLabel("받은 공유 코드", { exact: true }).fill(code);
    await guest.getByRole("button", { name: "연결 요청", exact: true }).click();
    await expect(
      guest.getByText("보내는 PC에서 상대 계정과 코드를 확인하면 연결됩니다."),
    ).toBeVisible();
    await owner.getByLabel("보내는 PC 코드 확인", { exact: true }).fill(code);
    await owner
      .getByRole("button", { name: "상대 확인 후 공유 연결", exact: true })
      .click();
    await expect(
      guest.getByLabel("인수인계 문서", { exact: true }),
    ).toHaveValue("구현 완료: 계정과 폴더\n다음: 디자인 검토");
    await expect(
      guest.getByLabel("인수인계 문서", { exact: true }),
    ).toBeDisabled();
    await guest
      .getByRole("button", {
        name: "Imported decision decision · 승인됨 · v2",
        exact: false,
      })
      .click();
    await expect(guest.getByLabel("기억 내용", { exact: true })).toHaveValue(
      "Choose PostgreSQL",
    );
    // Reload owner member list, then revoke and verify server denies subsequent guest reads.
    await owner
      .getByRole("button", { name: "Shared project · 내 폴더", exact: true })
      .click();
    await owner.getByRole("button", { name: "공유 철회", exact: true }).click();
    const response = await guest.request.get("/api/folders");
    expect(await response.json()).toEqual([]);
    await guest.reload();
    await guest
      .getByRole("button", { name: "프로젝트 · 인수인계", exact: true })
      .click();
    await expect(
      guest.getByRole("button", {
        name: "Shared project · 공유 · 읽기",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await a.close();
    await b.close();
  }
});
