import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readClientConnection } from "./lib/client-connection.mjs";
test("distinct provider credentials and explicit legacy fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "passport-client-"));
  try {
    await fs.mkdir(path.join(root, ".data"));
    for (const [name, token] of [
      ["", "legacy"],
      ["-claude", "claude-test"],
      ["-codex", "codex-test"],
    ])
      await fs.writeFile(
        path.join(root, `.data/service-client${name}.json`),
        JSON.stringify({ token }),
      );
    assert.equal(
      (await readClientConnection(root, "claude")).config.token,
      "claude-test",
    );
    assert.equal(
      (await readClientConnection(root, "codex")).config.token,
      "codex-test",
    );
    await fs.rm(path.join(root, ".data/service-client-codex.json"));
    assert.equal((await readClientConnection(root, "codex")).legacy, true);
    await fs.writeFile(
      path.join(root, ".data/service-client-claude.json"),
      "broken",
    );
    await assert.rejects(readClientConnection(root, "claude"));
    await assert.rejects(readClientConnection(root, "../../elsewhere"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
