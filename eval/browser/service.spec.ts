import { test, expect } from "@playwright/test";
test("two accounts auto-organize, share and revoke project context", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const owner = await a.newPage(),
    guest = await b.newPage();
  try {
    const suffix = Date.now().toString();
    const conversation =
      "# 2026-05-20\nChoose PostgreSQL\n# 2026-05-21\n로그인 화면을 구현하고 테스트를 통과했습니다.";
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
    await owner.locator(".drive-import > summary").click();
    await owner.getByLabel("가져오기 파일").setInputFiles({
      name: "passport-import.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              title: "Imported decision",
              content: conversation,
              source: "fixture.md",
              kind: "decision",
              projectName: "Shared project",
              projectPath: "/work/browser-project",
            },
          ],
        }),
      ),
    });
    await expect(
      owner.getByText("1개 기억을 폴더별로 정리했습니다.", { exact: false }),
    ).toBeVisible();
    await expect(
      owner.getByLabel("로컬 프로젝트 경로", { exact: true }),
    ).toHaveCount(0);
    await owner
      .getByRole("button", { name: "Shared project · 내 폴더", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "작업 타임라인" }),
    ).toBeVisible();
    await expect(owner.locator(".project-timeline")).toContainText(
      "Choose PostgreSQL",
    );
    await expect(owner.getByText("새 기억 작성", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      owner.getByText("기존 Passport 기억 복사", { exact: true }),
    ).toHaveCount(0);
    await expect(
      owner.getByText("고급 설정 · Codex · Claude 자동 연결", { exact: true }),
    ).toHaveCount(0);
    await expect(owner.locator(".timeline-date time")).toHaveText([
      "2026. 05. 20",
      "2026. 05. 21",
    ]);
    await expect(owner.locator(".timeline-detail")).toHaveCount(0);
    await owner.getByRole("button", { name: "시간순 ↑", exact: true }).click();
    await expect(owner.locator(".timeline-date time")).toHaveText([
      "2026. 05. 21",
      "2026. 05. 20",
    ]);
    await owner.getByText("원문 1개 보기", { exact: true }).click();
    await expect(
      owner.getByRole("button", {
        name: "Imported decision decision · 저장됨 · v1",
        exact: false,
      }),
    ).toBeVisible();
    await owner.getByText("진행 상황·인수인계", { exact: true }).click();
    await owner
      .getByLabel("인수인계 문서", { exact: true })
      .fill("구현 완료: 계정과 폴더\n다음: 디자인 검토");
    await owner.getByRole("button", { name: "변경 저장", exact: true }).click();
    await expect(
      owner.getByText("서버에 저장했습니다.", { exact: true }),
    ).toBeVisible();
    await owner.getByText("폴더 공유 · 비공개", { exact: true }).click();
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
    await guest
      .getByText("진행 상황·인수인계 · 작성됨", { exact: true })
      .click();
    await expect(
      guest.getByLabel("인수인계 문서", { exact: true }),
    ).toHaveValue("구현 완료: 계정과 폴더\n다음: 디자인 검토");
    await expect(
      guest.getByLabel("인수인계 문서", { exact: true }),
    ).toBeDisabled();
    await guest.locator(".timeline-day > summary").first().click();
    await guest
      .getByRole("button", { name: "원문 · Imported decision", exact: true })
      .first()
      .click();
    await guest
      .getByRole("button", {
        name: "Imported decision decision · 저장됨 · v1",
        exact: false,
      })
      .click();
    await expect(guest.getByLabel("기억 내용", { exact: true })).toHaveValue(
      conversation,
    );
    // Reload owner member list, then revoke and verify server denies subsequent guest reads.
    await owner.getByRole("button", { name: "내 폴더", exact: true }).click();
    await owner
      .getByRole("button", { name: "Shared project · 내 폴더", exact: true })
      .click();
    await owner.getByText("폴더 공유 · 1명과 공유 중", { exact: true }).click();
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
