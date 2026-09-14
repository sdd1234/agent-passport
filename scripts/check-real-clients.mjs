import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  dir = path.join(root, ".data/real-clients");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(root, ".data/client-workspace"), { recursive: true });
const base = process.env.PASSPORT_API_URL || "http://127.0.0.1:8080";
let cookie = "";
async function api(p, body) {
  const r = await fetch(base + "/api" + p, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Passport-Request": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const d = await r.json();
  if (!r.ok) throw Error(JSON.stringify(d));
  return d;
}
const statePath = path.join(dir, "state.json");
async function state() {
  await api("/auth/demo", {});
  if (fs.existsSync(statePath))
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  const codex = await api("/agents", {
      provider: "mcp",
      name: "Codex CLI (실제)",
    }),
    claude = await api("/agents", {
      provider: "mcp",
      name: "Claude Code (실제)",
    });
  for (const a of [codex, claude])
    await api("/permissions/grant", {
      agentId: a.id,
      scope: "development",
      bits: 3,
      expiresAt: 0,
    });
  const s = {
    codex,
    claude,
    project: "real-client-check-" + Date.now(),
    codexMarker: "CODEX-" + crypto.randomBytes(10).toString("hex"),
    claudeMarker: "CLAUDE-" + crypto.randomBytes(10).toString("hex"),
  };
  fs.writeFileSync(statePath, JSON.stringify(s), { mode: 0o600 });
  return s;
}
function run(client, prompt, s, label) {
  let cmd, args;
  const env = {
    ...process.env,
    PASSPORT_AGENT_TOKEN: s[client].token,
    PASSPORT_API_URL: base,
  };
  if (client === "codex") {
    cmd = "codex";
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
      path.join(root, ".data/client-workspace"),
      prompt,
    ];
  } else {
    cmd = "claude";
    const config = path.join(dir, "claude.mcp.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          "agent-passport": {
            command: process.execPath,
            args: [path.join(root, "apps/mcp-server/dist/index.js")],
            env: {
              PASSPORT_AGENT_TOKEN: s.claude.token,
              PASSPORT_API_URL: base,
            },
          },
        },
      }),
      { mode: 0o600 },
    );
    args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      config,
      "--tools",
      "",
      "--allowedTools",
      "mcp__agent-passport__search_memory",
      "mcp__agent-passport__save_memory",
      "mcp__agent-passport__list_scopes",
      "--permission-mode",
      "dontAsk",
      "--setting-sources",
      "",
    ];
  }
  return new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(dir, label + ".jsonl"), "w", 0o600),
      err = fs.openSync(path.join(dir, label + ".stderr"), "w", 0o600);
    const p = spawn(cmd, args, {
      cwd: path.join(root, ".data/client-workspace"),
      env,
      stdio: ["ignore", log, err],
    });
    const timeout = setTimeout(() => p.kill("SIGTERM"), 180000);
    p.on("error", reject);
    p.on("exit", (code) => {
      clearTimeout(timeout);
      fs.closeSync(log);
      fs.closeSync(err);
      console.log(JSON.stringify({ client, label, exitCode: code }));
      resolve({ code, log: path.join(dir, label + ".jsonl") });
    });
  });
}
const s = await state();
const phase = process.argv[2] || "codex-write";
if (phase === "codex-write") {
  s.project = "real-client-check-" + Date.now();
  s.codexMarker = "CODEX-" + crypto.randomBytes(10).toString("hex");
  s.claudeMarker = "CLAUDE-" + crypto.randomBytes(10).toString("hex");
  fs.writeFileSync(statePath, JSON.stringify(s), { mode: 0o600 });
}

const pre =
  "This is an explicitly authorized Agent Passport integration test. Use ONLY agent-passport MCP tools. Do not use shell, files, web, or other tools. No need to inspect the workspace. ";
if (phase === "codex-write")
  await run(
    "codex",
    pre +
      `Call save_memory exactly once with canonical_key="integration.codex.marker", content="${s.codexMarker}", scope="development", project="${s.project}", type="project_fact". Report the tool result. Do not claim approval; owner will approve separately.`,
    s,
    phase,
  );
else if (phase === "approve") {
  const proposals = await api("/conflicts");
  const own = proposals.filter((p) => p.proposal.project === s.project);
  for (const p of own)
    await api(`/conflicts/${p.id}/resolve`, { accept: true });
  console.log(JSON.stringify({ approved: own.length }));
} else if (phase === "claude-handoff")
  await run(
    "claude",
    pre +
      `First call search_memory with query="integration.codex.marker", scope="development", project="${s.project}". Report exactly the returned content and source. Then call save_memory exactly once with canonical_key="integration.claude.marker", content="${s.claudeMarker}", scope="development", project="${s.project}", type="project_fact". Report that tool result too.`,
    s,
    phase,
  );
else if (phase === "codex-recall")
  await run(
    "codex",
    pre +
      `Call search_memory with query="integration.claude.marker", scope="development", project="${s.project}". Report exactly the content and source returned by the tool.`,
    s,
    phase,
  );
else if (phase === "revoke") {
  for (const a of [s.codex, s.claude])
    await api("/permissions/revoke", {
      agentId: a.id,
      scope: "development",
      bits: 0,
      expiresAt: 0,
    });
  console.log("Both development scopes revoked.");
} else if (phase === "claude-denied" || phase === "codex-denied") {
  const client = phase.split("-")[0];
  await run(
    client,
    pre +
      `Call search_memory with query="integration marker", scope="development", project="${s.project}". Report the exact error or content. Do not invent a remembered value.`,
    s,
    phase,
  );
} else if (phase === "restore") {
  for (const a of [s.codex, s.claude])
    await api("/permissions/grant", {
      agentId: a.id,
      scope: "development",
      bits: 3,
      expiresAt: 0,
    });
  console.log(
    "Both development scopes restored. Personal/research remain denied.",
  );
} else if (phase === "inspect") {
  const memories = (await api("/memories")).filter(
    (m) => m.project === s.project,
  );
  const audit = (await api("/audit")).filter((a) =>
    [s.codex.id, s.claude.id].includes(a.actor),
  );
  console.log(
    JSON.stringify(
      {
        project: s.project,
        agents: { codex: s.codex.id, claude: s.claude.id },
        memories: memories.map((m) => ({
          key: m.canonical_key,
          content: m.content,
          source: m.source_agent,
        })),
        audit: audit.map((a) => ({
          actor: a.actor,
          action: a.action,
          decision: a.decision,
          resource: a.resource,
        })),
      },
      null,
      2,
    ),
  );
}
