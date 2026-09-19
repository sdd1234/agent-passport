import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { autoMemory, collectRecords } from "./lib/auto-memory.mjs";
const initial = {
  id: "11111111-1111-1111-1111-111111111111",
  provider: "codex",
  marker: "[Passport work session test]",
  offset: 0,
  bound: false,
  startedAt: Date.parse("2026-09-19T00:00:00Z"),
};
const line = (role, text, ordinal, type = "response_item") =>
  JSON.stringify({
    type,
    ordinal,
    timestamp: "2026-09-19T00:00:00Z",
    payload: { role, content: [{ type: "output_text", text }] },
  }) + "\n";
test("only launched conversation text, not environment/tools/reasoning/bootstrap; partial Unicode lines and stable retries", () => {
  const source = Buffer.from(
    line("user", "PRIVATE earlier instructions", 0) +
      line("assistant", initial.marker + "\nwrong role", 1) +
      line("user", initial.marker + "\nstart", 2) +
      line("user", "로그인 수정해줘", 3) +
      line("assistant", "로그인 수정 완료. password=abc123", 4) +
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call_output", output: "PRIVATE_TOOL" },
      }) +
      "\n" +
      JSON.stringify({
        type: "response_item",
        payload: { type: "reasoning", text: "PRIVATE_REASONING" },
      }) +
      "\n" +
      line("user", "<environment_context>PRIVATE_ENV</environment_context>", 5),
  );
  const result = collectRecords(source, initial);
  assert.equal(result.entries.length, 2);
  const content = result.entries.map((e) => e.content).join("\n");
  assert.match(content, /로그인 수정해줘/);
  assert.match(content, /\[REDACTED\]/);
  assert.doesNotMatch(content, /PRIVATE|abc123|start/);
  assert.deepEqual(collectRecords(source, initial).entries, result.entries);
  const more = Buffer.from(line("assistant", "한글 끝부분 추가 완료", 6));
  assert.equal(
    collectRecords(more.subarray(0, more.length - 2), {
      ...initial,
      bound: true,
    }).consumed,
    0,
  );
  assert.equal(
    collectRecords(more, { ...initial, bound: true }).entries.length,
    1,
  );
});

test("Claude captures ordinary dialogue and ignores sidechains, tools, images and thinking", () => {
  const record = (role, content, extra = {}) =>
    JSON.stringify({
      type: role,
      uuid: Math.random().toString(),
      timestamp: "2026-09-19T00:00:00Z",
      message: { role, content },
      ...extra,
    }) + "\n";
  const bytes = Buffer.from(
    record("user", initial.marker + "\nstart") +
      record("assistant", [
        { type: "thinking", thinking: "PRIVATE" },
        { type: "text", text: "수정 완료. 다음은 검증." },
        { type: "tool_use", input: { secret: "PRIVATE" } },
      ]) +
      record("user", [
        { type: "tool_result", content: "PRIVATE" },
        { type: "image", source: { data: "PRIVATE" } },
      ]) +
      record("assistant", "PRIVATE", { isSidechain: true }),
  );
  const result = collectRecords(bytes, { ...initial, provider: "claude" });
  assert.equal(result.entries.length, 1);
  assert.match(result.entries[0].content, /수정 완료/);
  assert.doesNotMatch(result.entries[0].content, /PRIVATE/);
});

test("long messages preserve all text with bounded, stable source keys", () => {
  const data = "가".repeat(65000) + "끝";
  const result = collectRecords(Buffer.from(line("assistant", data, 7)), {
    ...initial,
    bound: true,
  });
  assert.equal(result.entries.length, 3);
  assert.ok(result.entries.every((e) => e.content.length < 30000));
  assert.equal(
    result.entries
      .map((e) => e.content.split("\n").slice(1).join("\n"))
      .join(""),
    data,
  );
  assert.equal(new Set(result.entries.map((e) => e.sourceKey)).size, 3);
});

test("durable autosave retries after server acknowledgement loss and restart; other sessions/folders excluded; tail flush", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "passport-autosave-"));
  const roots = {
    codex: path.join(root, "codex"),
    claude: path.join(root, "claude"),
  };
  await fs.mkdir(roots.codex, { recursive: true });
  await fs.mkdir(roots.claude, { recursive: true });
  const stored = new Map();
  let fail = true;
  const upload = async (req, folder, entries) => {
    assert.equal(req.headers.cookie, "owner-session");
    assert.equal(folder, "chosen-folder");
    for (const e of entries) stored.set(e.sourceKey, e);
    if (fail) throw Error("network after commit");
  };
  try {
    const manager = autoMemory({ root, owner: "owner", roots, upload });
    const work = await manager.start({
      folderId: "chosen-folder",
      provider: "codex",
      cwd: "/work/project",
    });
    const meta =
      JSON.stringify({
        type: "session_meta",
        payload: { cwd: "/work/project" },
      }) + "\n";
    const file = path.join(roots.codex, "current.jsonl");
    await fs.writeFile(
      file,
      meta +
        line("user", work.marker + "\nstart", 0) +
        line("user", "구현 요청", 1) +
        line("assistant", "구현 완료. 다음 작업은 테스트.", 2),
    );
    await fs.writeFile(
      path.join(roots.codex, "unrelated.jsonl"),
      meta + line("user", "OTHER PRIVATE CONVERSATION", 1),
    );
    manager.useRequest({ headers: { cookie: "owner-session" } });
    await manager.tick();
    assert.equal(manager.status("chosen-folder").state, "error");
    assert.equal(manager.status("chosen-folder").pending, 2);
    assert.equal(stored.size, 2);
    const disk = JSON.parse(
      await fs.readFile(
        path.join(root, ".data/auto-memory/owner", work.id + ".json"),
      ),
    );
    assert.equal(disk.pending.length, 2);
    assert.equal(disk.pending[0].content.includes("OTHER"), false);
    assert.equal(JSON.stringify(disk).includes("owner-session"), false);
    fail = false;
    const recovered = autoMemory({ root, owner: "owner", roots, upload });
    await recovered.ready;
    recovered.useRequest({ headers: { cookie: "owner-session" } });
    await recovered.tick();
    assert.equal(recovered.status("chosen-folder").pending, 0);
    assert.equal(recovered.status("chosen-folder").saved, 2);
    assert.equal(stored.size, 2);
    assert.equal(recovered.status("different-folder").saved, 0);
    const next = await recovered.start({
      folderId: "chosen-folder",
      provider: "claude",
      cwd: "/work/project",
    });
    const transcript = path.join(roots.claude, next.id + ".jsonl");
    const row = (role, text, uuid) =>
      JSON.stringify({
        type: role,
        uuid,
        cwd: "/work/project",
        timestamp: "2026-09-19T01:00:00Z",
        message: { role, content: text },
      }) + "\n";
    await fs.writeFile(
      transcript,
      row("user", next.marker + "\nstart", "start") +
        row("assistant", "테스트 통과. 인수인계 완료.", "last"),
    );
    await recovered.close(next.id);
    assert.equal(stored.size, 3);
    assert.equal(recovered.status("chosen-folder").saved, 3);
    await recovered.tick();
    assert.equal(stored.size, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("closed transcripts save a complete final record without newline; unfinished records are held", () => {
  const bytes = Buffer.from(line("assistant", "마지막 작업 완료", 8).trimEnd());
  const open = collectRecords(bytes, { ...initial, bound: true });
  assert.equal(open.entries.length, 0);
  const closed = collectRecords(bytes, {
    ...initial,
    bound: true,
    closed: true,
  });
  assert.equal(closed.entries.length, 1);
  assert.equal(closed.consumed, bytes.length);
  assert.equal(
    collectRecords(bytes.subarray(0, bytes.length - 3), {
      ...initial,
      bound: true,
      closed: true,
    }).entries.length,
    0,
  );
});
