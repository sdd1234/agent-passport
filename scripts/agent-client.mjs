// Launch an ordinary real client with only the Passport connection added for this run.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const name = process.argv[2];
if (!["codex", "claude"].includes(name))
  throw new Error("Usage: node scripts/agent-client.mjs codex|claude");
if (!fs.existsSync(path.join(root, ".data/agent-connections.json")))
  throw new Error("Missing credentials. See docs/real-clients.md.");
const check = await fetch("http://127.0.0.1:8080/api/health").catch(() => null);
if (!check?.ok) throw new Error("Start Agent Passport with npm run dev first.");
const args =
  name === "codex"
    ? [
        "-C",
        root,
        "-c",
        `mcp_servers.agent-passport.command=${JSON.stringify(process.execPath)}`,
        "-c",
        `mcp_servers.agent-passport.args=${JSON.stringify([path.join(root, "scripts/mcp-client.mjs"), "codex"])}`,
        "-c",
        "mcp_servers.agent-passport.required=true",
        ...process.argv.slice(3),
      ]
    : [
        "--mcp-config",
        path.join(root, ".data/claude-passport.mcp.json"),
        ...process.argv.slice(3),
      ];
if (name === "claude")
  fs.writeFileSync(
    path.join(root, ".data/claude-passport.mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          "agent-passport": {
            command: process.execPath,
            args: [path.join(root, "scripts/mcp-client.mjs"), "claude"],
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
const child = spawn(name, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("error", (err) => {
  console.error(err.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
