import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
const root = path.resolve(import.meta.dirname, ".."),
  rl = createInterface({ input: process.stdin, output: process.stdout });
const provider = process.argv[2] === "--provider" ? process.argv[3] : "";
if (provider && !["codex", "claude"].includes(provider))
  throw new Error("provider must be codex or claude");
try {
  const apiUrl = (await rl.question("Passport server URL (https://...): "))
    .trim()
    .replace(/\/+$/, "");
  const url = new URL(apiUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Remote servers require HTTPS.");
  // Reading from an environment variable avoids echoing a token in terminal recording/history.
  const token = process.env.PASSPORT_AGENT_TOKEN;
  if (!token)
    throw new Error(
      "Set PASSPORT_AGENT_TOKEN using: read -rs PASSPORT_AGENT_TOKEN; export PASSPORT_AGENT_TOKEN",
    );
  await fs.mkdir(path.join(root, ".data"), { recursive: true });
  const file = path.join(
    root,
    `.data/service-client${provider ? "-" + provider : ""}.json`,
  );
  await fs.writeFile(file, JSON.stringify({ apiUrl, token }), { mode: 0o600 });
  await fs.chmod(file, 0o600);
  console.log(
    "Saved local connection. From your project directory run: node " +
      path.join(root, "scripts/launch-client.mjs") +
      " codex|claude",
  );
} finally {
  rl.close();
}
