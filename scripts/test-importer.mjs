import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collect, redact } from "./lib/importer.mjs";
test("local import uses explicit text, project metadata, redaction and no symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "passport-import-"));
  try {
    const dir = path.join(root, ".codex/sessions/2026"),
      claude = path.join(root, ".claude/projects/-test/memory");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(claude, { recursive: true });
    await fs.writeFile(
      path.join(dir, "session.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: { cwd: "/work/project" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            role: "system",
            content: [{ type: "input_text", text: "SYSTEM SECRET" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            role: "assistant",
            content: [{ type: "output_text", text: "Use PostgreSQL" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", output: "TOOL SECRET" },
        }),
      ].join("\n"),
    );
    await fs.writeFile(path.join(claude, "MEMORY.md"), "Project memory");
    await fs.writeFile(
      path.join(root, ".claude/projects/-test/a.jsonl"),
      JSON.stringify({
        cwd: "/work/project",
        type: "user",
        message: { role: "user", content: "Next task" },
      }),
    );
    await fs.symlink(
      path.join(dir, "session.jsonl"),
      path.join(claude, "secret.md"),
    );
    let result = await collect({ home: root });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].projectPath, "/work/project");
    result = await collect({ home: root, includeSessions: true });
    assert.equal(result.entries.length, 3);
    assert.equal(
      result.entries.some((e) => e.content.includes("SECRET")),
      false,
    );
    assert.equal(
      redact("api_key=sk-abcdefghijklmnopqrstuv").includes("sk-"),
      false,
    );
    assert.deepEqual(
      result.entries.map((e) => e.sourceKey),
      (await collect({ home: root, includeSessions: true })).entries.map(
        (e) => e.sourceKey,
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
