// Explicit local setup: never enroll an account through an HTTP endpoint.
import fs from "node:fs/promises";
import path from "node:path";
const username = process.argv[2];
if (!username)
  throw Error("Usage: node scripts/configure-terminal.mjs <account username>");
const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, ".data/pc-server/settings.json");
const settings = JSON.parse(await fs.readFile(file, "utf8"));
// Resolve through the local database without printing its credentials.
const { Client } = await import("pg");
const db = new Client({
  host: "127.0.0.1",
  port: settings.databasePort,
  user: "passport",
  password: settings.databasePassword,
  database: "passport",
});
await db.connect();
try {
  const { rows } = await db.query(
    "SELECT user_id FROM accounts WHERE username=$1",
    [username],
  );
  if (rows.length !== 1) throw Error("Account not found");
  settings.terminalOwner = rows[0].user_id;
  await fs.writeFile(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  console.log(
    "Local terminal account configured. Restart agent-passport to apply.",
  );
} finally {
  await db.end();
}
