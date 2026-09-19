import { readClientConnection } from "./lib/client-connection.mjs";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const provider = process.env.PASSPORT_CLIENT_PROVIDER || "";
const { config, legacy } = process.env.PASSPORT_CONNECTION_FILE
  ? {
      config: JSON.parse(
        await fs.readFile(process.env.PASSPORT_CONNECTION_FILE, "utf8"),
      ),
      legacy: false,
    }
  : await readClientConnection(root, provider);
if (legacy)
  console.error(
    "Using legacy shared connection. Set up a separate --provider connection for simultaneous collaboration.",
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
