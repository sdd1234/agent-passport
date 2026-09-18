import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConversation } from "./lib/conversations.mjs";
test("full long conversation preserves tail, roles and cwd without tool payloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "conversation-"));
  try {
    const file = path.join(dir, "test.jsonl");
    await fs.writeFile(
      file,
      [
        { type: "session_meta", payload: { cwd: "/work/test" } },
        {
          type: "response_item",
          payload: {
            role: "user",
            content: [
              { type: "input_text", text: "a".repeat(270000) + "END_MARKER" },
            ],
          },
        },
        {
          type: "response_item",
          payload: {
            role: "assistant",
            content: [{ type: "output_text", text: "Reply" }],
          },
        },
        {
          type: "response_item",
          payload: { type: "function_call_output", output: "PRIVATE_TOOL" },
        },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const result = await readConversation(file, "codex");
    assert.equal(result.cwd, "/work/test");
    assert.equal(result.messages, 2);
    const text = result.entries.map((e) => e.content).join("");
    assert.ok(text.includes("END_MARKER"));
    assert.ok(text.includes("Reply"));
    assert.ok(!text.includes("PRIVATE_TOOL"));
    assert.ok(result.entries.every((e) => e.content.length <= 30000));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Claude ignores tool blocks, preserves distinct messages and reports malformed lines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "conversation-"));
  try {
    const file = path.join(dir, "test.jsonl");
    const entry = {
      uuid: "one",
      cwd: "/work/project",
      timestamp: "2026-01-01",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Please continue" },
          { type: "tool_result", content: "not dialogue" },
        ],
      },
    };
    await fs.writeFile(
      file,
      [
        JSON.stringify(entry),
        JSON.stringify(entry),
        JSON.stringify({ ...entry, uuid: "two" }),
        "{truncated",
      ].join("\n"),
    );
    const result = await readConversation(file, "claude");
    assert.equal(result.messages, 2);
    assert.equal(result.malformed, 1);
    assert.equal(result.cwd, "/work/project");
    assert.ok(!result.entries[0].content.includes("not dialogue"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
