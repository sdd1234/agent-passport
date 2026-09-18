import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview } from "../apps/web/src/lib/overview.mjs";
test("source-backed sections preserve dates and do not use import timestamps", () => {
  const result = buildOverview([
    {
      id: "a",
      title: "Project",
      state: "approved",
      created_at: "2026-09-18",
      content:
        "# 목표\n팀 기록을 공유하는 서비스\n# 진행 2026-08-01\n로그인 구현 완료\n# 다음 작업\n공유 테스트 추가 필요\n# 결정\nPostgreSQL 채택",
    },
  ]);
  assert.equal(result.progress[0].date, "2026-08-01");
  assert.equal(result.next[0].entryId, "a");
  assert.equal(result.goal[0].date, "");
  assert.equal(result.decision[0].text, "PostgreSQL 채택");
});
test("pending, fenced code and frontmatter are not project evidence", () => {
  const result = buildOverview([
    { id: "a", state: "pending", content: "구현 완료 했음" },
    {
      id: "b",
      content:
        "---\nname: completed fake\n---\n```\n구현 완료 했음\n```\n# 다음 작업\n로그인은 아직 미완료",
    },
  ]);
  assert.equal(result.progress.length, 0);
  assert.equal(result.next.length, 1);
});

test("NextAuth completed work is not a next task", () => {
  const result = buildOverview([
    { id: "a", content: "NextAuth 로그인 구현 완료" },
  ]);
  assert.equal(result.next.length, 0);
  assert.equal(result.progress.length, 1);
});
