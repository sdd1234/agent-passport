import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  dir = path.join(root, ".data/real-clients");
const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
const read = (name) =>
  fs
    .readFileSync(path.join(dir, name + ".jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const codexCalls = (name) =>
  read(name)
    .filter(
      (e) => e.type === "item.completed" && e.item?.type === "mcp_tool_call",
    )
    .map((e) => ({
      tool: e.item.tool,
      status: e.item.status,
      args: e.item.arguments,
      result: JSON.parse(e.item.result.content[0].text),
    }));
const claudeCalls = (name) => {
  const events = read(name),
    calls = new Map();
  for (const e of events)
    for (const c of e.message?.content || []) {
      if (c.type === "tool_use")
        calls.set(c.id, { tool: c.name, args: c.input });
      if (c.type === "tool_result") {
        const call = calls.get(c.tool_use_id);
        if (call) {
          const content =
            typeof c.content === "string"
              ? c.content
              : c.content
                  .filter((x) => x.type === "text")
                  .map((x) => x.text)
                  .join("");
          call.result = JSON.parse(content);
          call.isError = c.is_error || false;
        }
      }
    }
  return [...calls.values()];
};
const write = codexCalls("codex-write"),
  handoff = claudeCalls("claude-handoff"),
  recall = codexCalls("codex-recall"),
  codexDeny = codexCalls("codex-denied"),
  claudeDeny = claudeCalls("claude-denied");
assert.equal(write.length, 1);
assert.equal(write[0].tool, "save_memory");
assert.equal(write[0].result.state, "pending");
const fromCodex = handoff
  .find((c) => c.tool.endsWith("search_memory"))
  .result.memories.find((m) => m.content === state.codexMarker);
assert.equal(fromCodex.source_agent, state.codex.id);
assert.equal(
  handoff.find((c) => c.tool.endsWith("save_memory")).result.state,
  "pending",
);
const fromClaude = recall
  .find((c) => c.tool === "search_memory")
  .result.memories.find((m) => m.content === state.claudeMarker);
assert.equal(fromClaude.source_agent, state.claude.id);
assert.equal(codexDeny[0].status, "failed");
assert.deepEqual(codexDeny[0].result, { code: "MEMORY_SCOPE_DENIED" });
assert.equal(claudeDeny[0].isError, true);
assert.deepEqual(claudeDeny[0].result, { code: "MEMORY_SCOPE_DENIED" });
for (const name of ["codex-write", "codex-recall", "codex-denied"])
  assert.equal(
    read(name).filter((e) => e.item?.type === "command_execution").length,
    0,
  );
const connected = read("claude-handoff").find(
  (e) => e.type === "system" && e.subtype === "init",
);
assert.equal(
  connected.mcp_servers.find((s) => s.name === "agent-passport").status,
  "connected",
);
const report = {
  verifiedAt: new Date().toISOString(),
  clients: {
    codex: {
      version: "0.154.0",
      authentication: "existing ChatGPT login",
      connection: "actual CLI → stdio MCP",
    },
    claude: {
      version: "2.1.236",
      authentication: "existing Claude login",
      modelReported: connected.model,
      connection: "actual Claude Code → stdio MCP",
    },
  },
  project: state.project,
  tests: {
    codexSaveProposal: true,
    ownerApproval: true,
    claudeReadsCodexBlindMarker: true,
    claudeSaveProposal: true,
    codexReadsClaudeBlindMarker: true,
    codexRevokeDenied: true,
    claudeRevokeDenied: true,
    sourceAgentVerified: true,
    noShellFallback: true,
  },
  testMarkers: { codex: state.codexMarker, claude: state.claudeMarker },
  evidence: {
    codexWrite: write,
    claudeHandoff: handoff,
    codexRecall: recall,
    codexDenied: codexDeny,
    claudeDenied: claudeDeny,
  },
  limits: [
    "This run used the local demo owner and local SQL permission backend.",
    "Real client/model calls used the existing CLI logins; the Playground raw API-key adapters were not exercised.",
    "Public testnet/wallet consent was not part of this client connectivity run.",
  ],
};
fs.writeFileSync(
  path.join(root, "docs/real-client-results.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "PASS: actual Codex ↔ Claude blind memory handoff, source binding, and revoked access denial.",
);
