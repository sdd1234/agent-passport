import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "../apps/web/src/lib/timeline.mjs";
test("chronological days distinguish requests from work and retain source links", () => {
  const days = buildTimeline([
    {
      id: "a",
      title: "Chat",
      kind: "session",
      content:
        "## 2026-05-21T01:00:00Z · 사용자\n로그인 화면을 추가해줘\n## 2026-05-21T01:10:00Z · 어시스턴트\n로그인 화면을 추가했고 테스트를 통과했습니다.\n## 2026-05-20T01:10:00Z · 어시스턴트\n다음 작업: 로그인 화면을 구현할 예정입니다.",
    },
  ]);
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-05-20", "2026-05-21"],
  );
  assert.equal(days[0].items[0].category, "next");
  assert.deepEqual(
    days[1].items.map((i) => i.category),
    ["request", "done"],
  );
  assert.equal(days[1].items[0].sources[0].entryId, "a");
});
test("memory frontmatter and local paths do not become daily highlights", () => {
  const days = buildTimeline([
    {
      id: "b",
      title: "Game",
      kind: "memory",
      created_at: "2026-09-18",
      content:
        "--\nname: project-game\ndescription: secret metadata\n---\n**위치**: `/home/test/game` 최근 커밋 (2026-05-20).\n**성격**: Godot 기반 연구용 게임.\n**구조**:\n- 진입: `scenes/title.tscn`\n- 적 15종과 무기 6종을 추가했습니다.\n**How to apply**: 새 적 추가 시 스크립트 연결.\n**다음 작업**:\n- 전투 난이도를 조정할 예정입니다.",
    },
  ]);
  assert.equal(days[0].date, "2026-05-20");
  const text = JSON.stringify(days[0].highlights);
  assert.ok(!text.includes("/home/"));
  assert.ok(!text.includes("scenes/"));
  assert.ok(!text.includes("secret metadata"));
  assert.ok(days[0].items.some((i) => i.text.includes("적 15종")));
  assert.ok(!days[0].items.some((i) => i.text.includes("How to apply")));
});
test("unknown dates remain unknown, pending and code excluded, duplicate source retained", () => {
  const e = {
    id: "a",
    title: "A",
    kind: "memory",
    created_at: "2026-09-18",
    content: "```\n검증 완료했습니다.\n```\n저장 오류를 수정했습니다.",
  };
  const days = buildTimeline([
    e,
    { ...e, id: "b" },
    { ...e, id: "c", state: "pending" },
  ]);
  assert.equal(days[0].date, "");
  assert.equal(days[0].items.length, 1);
  assert.equal(days[0].items[0].sources.length, 2);
});
test("Korean day boundary is applied to conversation timestamps", () => {
  const days = buildTimeline([
    {
      id: "a",
      kind: "session",
      content:
        "## 2026-05-20T16:10:00Z · 어시스턴트\n공유 기능 구현을 완료했습니다.",
    },
  ]);
  assert.equal(days[0].date, "2026-05-21");
});

test("unfinished work is never presented as a completed result", () => {
  const days = buildTimeline([
    {
      id: "a",
      kind: "memory",
      content: "로그인 구현은 아직 완료되지 않았습니다.",
    },
  ]);
  assert.equal(days[0].items[0].category, "next");
});
