import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
export async function verifyRealFolders({
  base,
  folderId,
  token,
  marker,
  dir,
  denied = false,
}) {
  const root = path.resolve(import.meta.dirname, ".."),
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "passport-client-fixture-"));
  try {
    for (const name of ["codex", "claude"]) {
      const label = `${name}-${denied ? "denied" : "read"}`,
        stdout = path.join(dir, label + ".jsonl"),
        stderr = path.join(dir, label + ".stderr");
      const pre =
        "This is an authorized integration test using only synthetic fixture data. Use ONLY the agent-passport get_folder_context MCP tool. Do not use files, shell, web, or other tools. ";
      const prompt =
        pre +
        `Call get_folder_context with folder_id ${folderId} exactly once. Report the tool result. Do not guess content. `;
      const env = {
        ...process.env,
        PASSPORT_AGENT_TOKEN: token,
        PASSPORT_API_URL: base,
      };
      let args;
      if (name === "codex")
        args = [
          "exec",
          "--ignore-user-config",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
          "-c",
          'approval_policy="never"',
          "-c",
          `mcp_servers.agent-passport.command=${JSON.stringify(process.execPath)}`,
          "-c",
          `mcp_servers.agent-passport.args=${JSON.stringify([path.join(root, "apps/mcp-server/dist/index.js")])}`,
          "-c",
          'mcp_servers.agent-passport.env_vars=["PASSPORT_AGENT_TOKEN","PASSPORT_API_URL"]',
          "-c",
          "mcp_servers.agent-passport.required=true",
          "-c",
          'mcp_servers.agent-passport.default_tools_approval_mode="approve"',
          "-C",
          cwd,
          prompt,
        ];
      else
        args = [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--no-session-persistence",
          "--strict-mcp-config",
          "--mcp-config",
          JSON.stringify({
            mcpServers: {
              "agent-passport": {
                command: process.execPath,
                args: [path.join(root, "apps/mcp-server/dist/index.js")],
              },
            },
          }),
          "--tools",
          "",
          "--allowedTools",
          "mcp__agent-passport__get_folder_context",
          "--permission-mode",
          "dontAsk",
          "--setting-sources",
          "",
        ];
      const out = fs.openSync(stdout, "w", 0o600),
        err = fs.openSync(stderr, "w", 0o600);
      try {
        await new Promise((resolve, reject) => {
          const p = spawn(name, args, {
            cwd,
            env,
            stdio: ["ignore", out, err],
          });
          const timeout = setTimeout(() => p.kill("SIGTERM"), 180000);
          p.on("error", (e) => {
            clearTimeout(timeout);
            reject(e);
          });
          p.on("exit", (code) => {
            clearTimeout(timeout);
            code === 0
              ? resolve()
              : reject(
                  new Error(`${label} failed; inspect private log ${stderr}`),
                );
          });
        });
      } finally {
        fs.closeSync(out);
        fs.closeSync(err);
      }
      const events = fs
        .readFileSync(stdout, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      let calls = [];
      if (name === "codex") {
        assert.equal(
          events.some((e) => e.item?.type === "command_execution"),
          false,
          "Unexpected shell tool",
        );
        calls = events
          .filter(
            (e) =>
              e.type === "item.completed" && e.item?.type === "mcp_tool_call",
          )
          .map((e) => ({
            name: e.item.tool,
            result: e.item.result,
            isError: e.item.status === "failed",
          }));
      } else {
        const map = new Map();
        for (const e of events)
          for (const c of e.message?.content || []) {
            if (c.type === "tool_use") {
              assert.equal(c.name, "mcp__agent-passport__get_folder_context");
              map.set(c.id, { name: c.name });
            }
            if (c.type === "tool_result" && map.has(c.tool_use_id)) {
              let result =
                typeof c.content === "string"
                  ? c.content
                  : c.content
                      .filter((x) => x.type === "text")
                      .map((x) => x.text)
                      .join("");
              map.get(c.tool_use_id).result = result;
              map.get(c.tool_use_id).isError = !!c.is_error;
            }
          }
        calls = [...map.values()];
      }
      assert.equal(calls.length, 1, `${label}: expected one actual MCP call`);
      assert.ok(calls[0].name.endsWith("get_folder_context"));
      const result =
        typeof calls[0].result === "string"
          ? calls[0].result
          : JSON.stringify(calls[0].result);
      if (denied) {
        assert.ok(result.includes("FOLDER_ACCESS_DENIED"));
        assert.equal(result.includes(marker), false);
      } else {
        assert.ok(
          result.includes(marker),
          `${label}: marker absent from MCP result`,
        );
        assert.equal(calls[0].isError, false);
      }
      console.log(
        `PASS: actual ${name} ${denied ? "revoked access denied" : "folder context read"}`,
      );
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
