import path from "node:path";
import { spawn } from "node:child_process";
const name = process.argv[2],
  root = path.resolve(import.meta.dirname, "..");
if (!["codex", "claude"].includes(name))
  throw new Error(
    "Usage: node /path/to/scripts/launch-client.mjs codex|claude [arguments]",
  );
const server = {
  command: process.execPath,
  args: [path.join(root, "scripts/service-mcp.mjs")],
  env: { PASSPORT_PROJECT_CWD: process.cwd(), PASSPORT_CLIENT_PROVIDER: name },
};
const args =
  name === "codex"
    ? [
        "-c",
        `mcp_servers.agent-passport.command=${JSON.stringify(server.command)}`,
        "-c",
        `mcp_servers.agent-passport.args=${JSON.stringify(server.args)}`,
        "-c",
        'mcp_servers.agent-passport.env_vars=["PASSPORT_PROJECT_CWD","PASSPORT_CLIENT_PROVIDER"]',
        "-c",
        "mcp_servers.agent-passport.required=true",
      ]
    : [
        "--mcp-config",
        JSON.stringify({ mcpServers: { "agent-passport": server } }),
      ];
const child = spawn(name, [...args, ...process.argv.slice(3)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PASSPORT_PROJECT_CWD: process.cwd(),
    PASSPORT_CLIENT_PROVIDER: name,
  },
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
