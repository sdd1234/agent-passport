// Start an agent-bound MCP server without putting its token in CLI arguments or config.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const name = process.argv[2];
if (!["codex", "claude"].includes(name))
  throw new Error("Expected codex or claude");
const file = path.join(root, ".data/agent-connections.json");
if (!fs.existsSync(file))
  throw new Error(
    "Missing local Agent Passport credentials. See docs/real-clients.md.",
  );
const config = JSON.parse(fs.readFileSync(file, "utf8"));
const child = spawn(
  process.execPath,
  [path.join(root, "apps/mcp-server/dist/index.js")],
  {
    env: {
      ...process.env,
      PASSPORT_AGENT_TOKEN: config[name].token,
      PASSPORT_API_URL: config.apiUrl || "http://127.0.0.1:8080",
    },
    stdio: "inherit",
  },
);
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("error", (err) => {
  console.error(err.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
