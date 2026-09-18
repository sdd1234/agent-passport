import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
export async function verifyRealCollaboration({
  base,
  folderId,
  participants,
  dir,
}) {
  const root = path.resolve(import.meta.dirname, "..");
  async function run({ name, token, taskId }) {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "passport-collaboration-"),
    );
    const output = path.join(dir, `collaboration-${name}.jsonl`),
      error = path.join(dir, `collaboration-${name}.stderr`);
    const prompt = `Authorized integration test with synthetic data only. Use ONLY agent-passport MCP tools. Do not use shell, files, web or delegate. Folder ${folderId}. First get_folder_tasks. Then claim_folder_task task ${taskId} with revision 1. Then update_folder_task task ${taskId} with returned revision, status done, progress exactly "${name} collaboration verified". Then get_folder_tasks again and report teammate progress. Stop on any tool error; do not invent results.`;
    const env = {
      ...process.env,
      PASSPORT_API_URL: base,
      PASSPORT_AGENT_TOKEN: token,
    };
    const args =
      name === "codex"
        ? [
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
          ]
        : [
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
            "mcp__agent-passport__get_folder_tasks",
            "mcp__agent-passport__claim_folder_task",
            "mcp__agent-passport__update_folder_task",
            "--permission-mode",
            "dontAsk",
            "--setting-sources",
            "",
          ];
    const out = fs.openSync(output, "w", 0o600),
      err = fs.openSync(error, "w", 0o600);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(name, args, {
          cwd,
          env,
          stdio: ["ignore", out, err],
        });
        const timer = setTimeout(() => child.kill("SIGTERM"), 180000);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(
                Error(`${name} integration failed; see private log ${error}`),
              );
        });
      });
      const events = fs
        .readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const names = [];
      for (const event of events) {
        if (event.item?.type === "command_execution")
          throw Error("Unexpected shell use");
        if (
          event.type === "item.completed" &&
          event.item?.type === "mcp_tool_call"
        )
          names.push(event.item.tool);
        for (const item of event.message?.content || [])
          if (item.type === "tool_use") {
            assert.ok(item.name.startsWith("mcp__agent-passport__"));
            names.push(item.name);
          }
      }
      for (const tool of [
        "get_folder_tasks",
        "claim_folder_task",
        "update_folder_task",
      ])
        assert.ok(
          names.some((n) => n.endsWith(tool)),
          `${name} did not invoke ${tool}`,
        );
      console.log(
        `PASS: actual ${name} claimed task and published progress using MCP`,
      );
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
  const results = await Promise.allSettled(participants.map(run));
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
