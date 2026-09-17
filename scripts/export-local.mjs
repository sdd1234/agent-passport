import { collect } from "./lib/importer.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const args = process.argv.slice(2),
  projects = [];
let output = "",
  includeSessions = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project" && args[i + 1])
    projects.push(path.resolve(args[++i]));
  else if (args[i] === "--output" && args[i + 1])
    output = path.resolve(args[++i]);
  else if (args[i] === "--include-sessions") includeSessions = true;
  else
    throw new Error(
      "Usage: npm run memory:export -- --output /private/passport-import.json [--project /absolute/project] [--include-sessions]",
    );
}
if (!output)
  throw new Error("--output is required; no data is printed or uploaded.");
const bundle = await collect({
  home: os.homedir(),
  codexHome: process.env.CODEX_HOME,
  claudeHome: process.env.CLAUDE_CONFIG_DIR,
  projects,
  includeSessions,
});
await fs.writeFile(output, JSON.stringify(bundle, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  `Saved ${bundle.entries.length} entries to ${output}. Open 가져오기 in Agent Passport to review. Nothing was uploaded.`,
);
