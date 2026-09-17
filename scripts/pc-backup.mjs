import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
process.umask(0o077);
const root = path.resolve(import.meta.dirname, ".."),
  dir = path.join(root, ".data/pc-server"),
  config = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
const [mode, fileArg] = process.argv.slice(2);
if (!["backup", "restore"].includes(mode) || !fileArg)
  throw new Error(
    "Usage: node scripts/pc-backup.mjs backup|restore /private/file.dump",
  );
const file = path.resolve(fileArg),
  lib = path.join(root, ".tools/pg-client/root/usr/lib/x86_64-linux-gnu");
const bin =
  mode === "backup"
    ? process.env.PG_DUMP_BIN ||
      path.join(root, ".tools/pg-client/root/usr/lib/postgresql/16/bin/pg_dump")
    : process.env.PG_RESTORE_BIN ||
      path.join(
        root,
        ".tools/pg-client/root/usr/lib/postgresql/16/bin/pg_restore",
      );
if (!fs.existsSync(bin))
  throw new Error("Run bash scripts/setup-pg-client.sh first.");
if (mode === "restore" && process.env.PASSPORT_RESTORE_CONFIRM !== "restore")
  throw new Error(
    "Stop agent-passport.service, verify the destination, and set PASSPORT_RESTORE_CONFIRM=restore.",
  );
if (mode === "backup" && fs.existsSync(file))
  throw new Error("Backup destination already exists.");
if (mode === "restore" && !fs.existsSync(file))
  throw new Error("Backup not found.");
let pg;
const temporary = file + ".tmp-" + process.pid;
try {
  if (mode === "restore") {
    pg = new EmbeddedPostgres({
      databaseDir: path.join(dir, "postgres"),
      user: "passport",
      password: config.databasePassword,
      port: config.databasePort,
      persistent: true,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    await pg.start();
  }
  const args = [
    "-h",
    "127.0.0.1",
    "-p",
    String(config.databasePort),
    "-U",
    "passport",
    "-d",
    "passport",
    ...(mode === "backup"
      ? ["-Fc", "-f", temporary]
      : [
          "--clean",
          "--if-exists",
          "--single-transaction",
          "--exit-on-error",
          file,
        ]),
  ];
  await new Promise((resolve, reject) => {
    const p = spawn(bin, args, {
      env: {
        ...process.env,
        PGPASSWORD: config.databasePassword,
        LD_LIBRARY_PATH:
          lib +
          (process.env.LD_LIBRARY_PATH
            ? ":" + process.env.LD_LIBRARY_PATH
            : ""),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let message = "";
    p.stderr.on("data", (b) => (message += b));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Database operation failed: " + message)),
    );
  });
  if (mode === "backup") fs.renameSync(temporary, file);
  console.log(
    `${mode === "backup" ? "Backup saved" : "Backup restored"}: ${file}. Keep the original settings.json encryption key separately.`,
  );
} finally {
  if (mode === "backup" && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  await pg?.stop().catch(() => {});
}
