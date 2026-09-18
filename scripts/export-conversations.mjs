import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { conversationFiles, readConversation } from "./lib/conversations.mjs";
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  if (
    !["--output", "--codex-home", "--claude-home"].includes(args[i]) ||
    !args[i + 1]
  )
    throw Error(
      "Usage: --output /private/conversations.json [--codex-home PATH] [--claude-home PATH]",
    );
  options[args[i]] = args[++i];
}
if (!options["--output"]) throw Error("--output is required");
const codex =
    options["--codex-home"] ||
    process.env.CODEX_HOME ||
    path.join(os.homedir(), ".codex"),
  claude =
    options["--claude-home"] ||
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), ".claude");
const entries = [],
  sources = [];
for (const [provider, root] of [
  ["codex", path.join(codex, "sessions")],
  ["codex", path.join(codex, "archived_sessions")],
  ["claude", path.join(claude, "projects")],
])
  for (const file of await conversationFiles(root)) {
    const result = await readConversation(file, provider);
    sources.push({
      source: file,
      provider,
      messages: result.messages,
      malformed: result.malformed,
      bytes: result.bytes,
    });
    const generic = /^(?:\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)$/.test(
      result.cwd,
    );
    entries.push(
      ...result.entries.map((e) => ({
        ...e,
        projectPath: generic ? "" : result.cwd,
        projectName: "",
      })),
    );
  }
await fs.writeFile(
  options["--output"],
  JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    entries,
    sources,
    warnings: [
      "Text user/assistant messages only; tool results, reasoning and image bytes excluded. Known secret patterns masked. Check sources.malformed for damaged records.",
    ],
  }),
  { mode: 0o600, flag: "wx" },
);
console.log(
  `Saved ${entries.length} entries from ${sources.length} files. Nothing uploaded.`,
);
