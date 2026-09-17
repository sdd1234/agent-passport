import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(
  await fs.readFile(path.join(root, ".data/service-client.json"), "utf8"),
);
const url = new URL(config.apiUrl);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
)
  throw new Error("Remote server requires HTTPS");
process.env.PASSPORT_API_URL = config.apiUrl;
process.env.PASSPORT_AGENT_TOKEN = config.token;
await import("../apps/mcp-server/dist/index.js");
