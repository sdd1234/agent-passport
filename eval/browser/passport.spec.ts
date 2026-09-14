import { test, expect } from "@playwright/test";
test("dashboard: approve conflict → Claude recall → revoke → deny → regrant → allow", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "데모 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "나의 기억" })).toBeVisible();
  await page.screenshot({ path: "docs/prototype-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "검토함", exact: false })
    .first()
    .click();
  const approvals = page.getByRole("button", { name: "승인하기" });
  if (await approvals.count()) await approvals.first().click();
  await page.getByRole("button", { name: "Agent 플레이그라운드" }).click();
  await page
    .getByLabel("anthropic 메시지")
    .fill("우리 프로젝트 기술 스택 알려줘.");
  await page.getByRole("button", { name: "anthropic 전송" }).click();
  await expect(
    page.locator(".chat-panel").nth(1).locator(".message.assistant"),
  ).toContainText("Spring Boot");
  await page.screenshot({
    path: "docs/prototype-playground.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "접근 권한", exact: true }).click();
  const read = page.getByRole("switch", {
    name: "Claude Agent development READ",
  });
  await expect(read).toHaveAttribute("aria-checked", "true");
  await read.click();
  await expect(read).toHaveAttribute("aria-checked", "false");
  await page.screenshot({
    path: "docs/prototype-permissions.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Agent 플레이그라운드" }).click();
  await page
    .getByLabel("anthropic 메시지")
    .fill("우리 프로젝트 기술 스택 알려줘.");
  await page.getByRole("button", { name: "anthropic 전송" }).click();
  await expect(page.locator(".message.error")).toContainText(
    "접근이 차단되었습니다",
  );
  await page.getByRole("button", { name: "접근 권한", exact: true }).click();
  await read.click();
  await expect(read).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Agent 플레이그라운드" }).click();
  await page
    .getByLabel("anthropic 메시지")
    .fill("우리 프로젝트 기술 스택 알려줘.");
  await page.getByRole("button", { name: "anthropic 전송" }).click();
  await expect(
    page.locator(".chat-panel").nth(1).locator(".message.assistant"),
  ).toContainText("PostgreSQL");
  await page.getByRole("button", { name: "기억 탐색기", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "나의 기억" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/prototype-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("manual memory requires approval and survives reload", async ({
  page,
}) => {
  const key = "test.manual." + Date.now();
  const content = "새 기억 검증 " + key;
  await page.goto("/");
  await page.getByRole("button", { name: "데모 시작하기" }).click();
  await page.getByRole("button", { name: "기억 추가", exact: true }).click();
  await page.getByLabel("기억 키").fill(key);
  await page.getByLabel("기억할 내용").fill(content);
  await page.getByRole("button", { name: "기억 후보 만들기" }).click();
  await expect(page.getByText(content)).toBeVisible();
  await page.getByRole("button", { name: "승인하기" }).first().click();
  await page.getByRole("button", { name: "기억 탐색기", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: content })).toBeVisible();
  const memories = await (await page.request.get("/api/memories")).json();
  const memory = memories.find(
    (m: { canonical_key: string }) => m.canonical_key === key,
  );
  await page.request.delete("/api/memories/" + memory.id, {
    headers: { "X-Passport-Request": "1" },
  });
});

test("GPT extracts two new memories, owner approves, fresh Claude reads the GPT source", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "데모 시작하기" }).click();
  await page.getByRole("button", { name: "Agent 플레이그라운드" }).click();
  const project = "handoff-" + Date.now();
  await page.getByLabel("채팅 프로젝트").fill(project);
  await page
    .getByLabel("openai 메시지")
    .fill("백엔드는 Spring Boot, DB는 PostgreSQL로 하자.");
  await page.getByRole("button", { name: "openai 전송" }).click();
  await expect(page.locator(".chat-panel").first()).toContainText(
    "기억 후보 2건",
  );
  await page.getByRole("button", { name: "검토함", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "승인하기" }).first().click();
    await expect(page.getByRole("button", { name: "승인하기" })).toHaveCount(
      1 - i,
    );
  }
  await page.getByRole("button", { name: "Agent 플레이그라운드" }).click();
  await page.getByLabel("채팅 프로젝트").fill(project);
  await page
    .getByLabel("anthropic 메시지")
    .fill("프로젝트의 백엔드와 DB를 알려줘.");
  await page.getByRole("button", { name: "anthropic 전송" }).click();
  await expect(
    page.locator(".chat-panel").nth(1).locator(".message.assistant"),
  ).toContainText("Spring Boot");
  await expect(
    page.locator(".chat-panel").nth(1).locator(".message.assistant"),
  ).toContainText("PostgreSQL");
  const memories = await (
    await page.request.get("/api/memories?project=" + project)
  ).json();
  const agents = await (await page.request.get("/api/agents")).json();
  const gpt = agents.find((a: { provider: string }) => a.provider === "openai");
  expect(memories).toHaveLength(2);
  expect(
    memories.every((m: { source_agent: string }) => m.source_agent === gpt.id),
  ).toBe(true);
  for (const memory of memories)
    await page.request.delete("/api/memories/" + memory.id, {
      headers: { "X-Passport-Request": "1" },
    });
});
