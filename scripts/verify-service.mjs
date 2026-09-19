import { verifyRealCollaboration } from "./real-collaboration-clients.mjs";
import { verifyRealFolders } from "./real-folder-clients.mjs";
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = path.resolve(import.meta.dirname, ".."),
  dir = fs.mkdtempSync(path.join(root, ".data/service-verify-"));
const port = Number(process.env.VERIFY_SERVICE_PORT || 18086),
  pgPort = Number(process.env.VERIFY_SERVICE_PG_PORT || 55441),
  base = `http://127.0.0.1:${port}`;
const pg = new EmbeddedPostgres({
  databaseDir: path.join(dir, "postgres"),
  user: "passport_test",
  password: "isolated-test-only",
  port: pgPort,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let processApi, sql, client;
const output = fs.openSync(path.join(dir, "api.log"), "a");
const env = {
  ...process.env,
  APP_MODE: "service",
  DEPLOYMENT: "development",
  APP_ORIGIN: base,
  COOKIE_SECURE: "false",
  BIND_ADDRESS: "127.0.0.1",
  PORT: String(port),
  DATABASE_URL: `jdbc:postgresql://127.0.0.1:${pgPort}/passport_service`,
  DATABASE_USER: "passport_test",
  DATABASE_PASSWORD: "isolated-test-only",
  MEMORY_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  SEARCH_MODE: "lexical",
  STRIPE_SECRET_KEY: "",
  STRIPE_PRICE_ID: "",
  STRIPE_WEBHOOK_SECRET: "",
  TRUST_PROXY_HEADER: "false",
};
async function stop() {
  if (!processApi) return;
  const p = processApi;
  processApi = null;
  await new Promise((resolve) => {
    p.once("exit", resolve);
    p.kill("SIGTERM");
    setTimeout(() => p.kill("SIGKILL"), 5000).unref();
    if (p.exitCode !== null) resolve();
  });
}
async function start() {
  processApi = spawn("java", ["-jar", "apps/api/target/api-0.1.0.jar"], {
    cwd: root,
    env,
    stdio: ["ignore", output, output],
  });
  for (let i = 0; i < 80; i++) {
    if (processApi.exitCode !== null)
      throw new Error("API exited; inspect " + path.join(dir, "api.log"));
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("API startup timeout");
}
async function api(user, url, body, method, status = 200) {
  const r = await fetch(base + "/api" + url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      "X-Passport-Request": "1",
      ...(user?.cookie ? { Cookie: user.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.headers.get("set-cookie") && user)
    user.cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, status, `${url}: ${data.code || r.status}`);
  return data;
}
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("passport_service");
  sql = pg.getPgClient("passport_service");
  await sql.connect();
  // Upgrade an existing pre-Flyway database rather than only testing an empty schema.
  await sql.query(
    fs.readFileSync(
      path.join(
        root,
        "apps/api/src/main/resources/db/migration/V1__memory_base.sql",
      ),
      "utf8",
    ),
  );
  await sql.query("INSERT INTO users VALUES('legacy-user','legacy-salt',1)");
  await start();
  assert.equal((await api(null, "/health")).mode, "service");
  await api({}, "/auth/demo", {}, undefined, 404);
  assert.equal(
    (await sql.query("SELECT COUNT(*) FROM users WHERE id='legacy-user'"))
      .rows[0].count,
    "1",
  );
  assert.equal(
    (
      await sql.query(
        "SELECT COUNT(*) FROM flyway_schema_history WHERE success=true",
      )
    ).rows[0].count,
    "6",
  );
  const owner = {},
    guest = {};
  await api(owner, "/account/register", {
    username: "serviceowner",
    password: "service-owner-password",
  });
  const other = await api(guest, "/account/register", {
    username: "serviceguest",
    password: "service-guest-password",
  });
  const folder = await api(owner, "/folders", {
    name: "Service project",
    projectPath: "/work/service",
  });
  const marker = "SERVICE-" + crypto.randomBytes(12).toString("hex");
  const imported = await api(owner, `/folders/${folder.id}/import`, {
    entries: [
      {
        title: "Decision",
        content: marker,
        source: "/private/fixture.md",
        kind: "decision",
        sourceKey: "fixture-1",
      },
    ],
  });
  const pair = await api(owner, "/pairings", {
    folderId: folder.id,
    role: "editor",
  });
  await api(guest, "/pairings/join", { code: pair.code });
  await api(owner, `/pairings/${pair.id}/confirm`, { code: pair.code });
  await api(guest, `/folders/${folder.id}/binding`, {
    localPath: "/team/project",
  });
  const originalEntry = (await api(owner, `/folders/${folder.id}/entries`))[0];
  await api(
    guest,
    `/folders/${folder.id}/entries/${originalEntry.id}`,
    {
      title: "Collaborator edit",
      content: "Synthetic changed context",
      revision: originalEntry.revision,
    },
    "PATCH",
  );
  const changed = (await api(owner, `/folders/${folder.id}/history`)).find(
    (e) => e.action === "EDIT" && e.entity_id === originalEntry.id,
  );
  const detail = await api(
    owner,
    `/folders/${folder.id}/history/${changed.id}`,
  );
  await api(owner, `/folders/${folder.id}/history/${changed.id}/restore`, {
    side: "before",
    expectedRevision: detail.expectedRevision,
    expectedHead: detail.expectedHead,
  });
  assert.equal(
    (await api(owner, `/folders/${folder.id}/entries`))[0].content,
    originalEntry.content,
  );
  const agent = await api(guest, "/agents", {
    provider: "mcp",
    name: "Service MCP",
  });
  await api(guest, `/folders/${folder.id}/agent-grants`, {
    agentId: agent.id,
    bits: 3,
  });
  client = new Client({ name: "service-test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["apps/mcp-server/dist/index.js"],
      env: {
        ...process.env,
        PASSPORT_API_URL: base,
        PASSPORT_AGENT_TOKEN: agent.token,
        PASSPORT_PROJECT_CWD: "/team/project",
      },
    }),
  );
  const task = await api(owner, `/folders/${folder.id}/tasks`, {
    title: "Collaborative API",
    description: "Synthetic integration",
    workScope: "api",
  });
  let taskReply = await client.callTool({
    name: "claim_folder_task",
    arguments: { folder_id: folder.id, task_id: task.id, revision: 1 },
  });
  assert.ok(!taskReply.isError);
  taskReply = await client.callTool({
    name: "update_folder_task",
    arguments: {
      folder_id: folder.id,
      task_id: task.id,
      revision: 2,
      status: "done",
      progress: "PostgreSQL collaboration stored",
    },
  });
  assert.ok(!taskReply.isError);
  if (process.env.PASSPORT_VERIFY_REAL_COLLABORATION === "true") {
    const collaborator = await api(owner, "/agents", {
      provider: "mcp",
      name: "Codex collaboration test",
    });
    await api(owner, `/folders/${folder.id}/agent-grants`, {
      agentId: collaborator.id,
      bits: 3,
    });
    const web = await api(owner, `/folders/${folder.id}/tasks`, {
      title: "Web",
      description: "Synthetic",
      workScope: "web",
    });
    const backend = await api(owner, `/folders/${folder.id}/tasks`, {
      title: "Backend",
      description: "Synthetic",
      workScope: "backend",
    });
    await verifyRealCollaboration({
      base,
      folderId: folder.id,
      dir,
      participants: [
        { name: "codex", token: collaborator.token, taskId: web.id },
        { name: "claude", token: agent.token, taskId: backend.id },
      ],
    });
    const tasks = await api(owner, `/folders/${folder.id}/tasks`);
    assert.equal(
      tasks.find((t) => t.id === web.id).progress,
      "codex collaboration verified",
    );
    assert.equal(
      tasks.find((t) => t.id === backend.id).progress,
      "claude collaboration verified",
    );
    assert.ok(
      tasks
        .filter((t) => [web.id, backend.id].includes(t.id))
        .every((t) => t.status === "done"),
    );
  }
  let result = await client.callTool({
    name: "get_folder_context",
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).entries[0].content, marker);
  result = await client.callTool({
    name: "propose_folder_memory",
    arguments: {
      folder_id: folder.id,
      title: "Next work",
      content: "Verify the handoff",
      kind: "todo",
    },
  });
  assert.equal(JSON.parse(result.content[0].text).state, "pending");
  const proposals = await api(owner, `/folders/${folder.id}/proposals`);
  await api(
    owner,
    `/folders/${folder.id}/proposals/${proposals[0].id}/review`,
    { accept: true },
  );
  if (process.env.PASSPORT_VERIFY_REAL_CLIENTS === "true")
    await verifyRealFolders({
      base,
      folderId: folder.id,
      token: agent.token,
      marker,
      dir,
    });
  // Restart proves both account session persistence and database-backed content.
  await stop();
  await start();
  assert.ok(
    (await api(owner, `/folders/${folder.id}/history`)).some(
      (e) => e.action === "RESTORE",
    ),
  );

  assert.equal(
    (await api(owner, `/folders/${folder.id}/tasks`)).find(
      (t) => t.id === task.id,
    ).progress,
    "PostgreSQL collaboration stored",
  );

  assert.equal((await api(guest, "/me")).owner, other.owner);
  assert.equal((await api(guest, `/folders/${folder.id}/entries`)).length, 2);
  await api(
    owner,
    `/folders/${folder.id}/members/${other.owner}`,
    undefined,
    "DELETE",
  );
  result = await client.callTool({
    name: "get_folder_context",
    arguments: { folder_id: folder.id },
  });
  assert.equal(result.isError, true);
  await api(guest, `/folders/${folder.id}`, undefined, undefined, 403);
  if (process.env.PASSPORT_VERIFY_REAL_CLIENTS === "true")
    await verifyRealFolders({
      base,
      folderId: folder.id,
      token: agent.token,
      marker,
      dir,
      denied: true,
    });
  const exported = await api(owner, "/account/export");
  assert.equal(exported.folders.length, 1);
  if (process.env.PG_DUMP_BIN && process.env.PG_RESTORE_BIN) {
    const run = (cmd, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
          env: { ...process.env, PGPASSWORD: "isolated-test-only" },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let err = "";
        child.stderr.on("data", (b) => {
          err += b;
        });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(err)),
        );
      });
    const dump = path.join(dir, "fixture.dump");
    await run(process.env.PG_DUMP_BIN, [
      "-h",
      "127.0.0.1",
      "-p",
      String(pgPort),
      "-U",
      "passport_test",
      "-d",
      "passport_service",
      "-Fc",
      "-f",
      dump,
    ]);
    await pg.createDatabase("passport_restore");
    await run(process.env.PG_RESTORE_BIN, [
      "-h",
      "127.0.0.1",
      "-p",
      String(pgPort),
      "-U",
      "passport_test",
      "-d",
      "passport_restore",
      "--single-transaction",
      "--exit-on-error",
      dump,
    ]);
    const restored = pg.getPgClient("passport_restore");
    await restored.connect();
    try {
      assert.equal(
        (await restored.query("SELECT COUNT(*) FROM folder_entries")).rows[0]
          .count,
        "2",
      );
      const cipher = (
        await restored.query("SELECT content FROM folder_entries WHERE id=$1", [
          imported.entryIds[0],
        ])
      ).rows[0].content;
      const [iv, raw] = cipher.split(":");
      const payload = Buffer.from(raw, "base64");
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.from(env.MEMORY_ENCRYPTION_KEY, "base64"),
        Buffer.from(iv, "base64"),
      );
      decipher.setAuthTag(payload.subarray(-16));
      assert.equal(
        Buffer.concat([
          decipher.update(payload.subarray(0, -16)),
          decipher.final(),
        ]).toString(),
        marker,
      );
    } finally {
      await restored.end();
    }
    console.log(
      "PASS: pg_dump/pg_restore to a separate database with encrypted content recovery.",
    );
  }

  await api(
    owner,
    "/account",
    { password: "service-owner-password", confirmation: "DELETE" },
    "DELETE",
  );
  await api(owner, "/me", undefined, undefined, 401);
  assert.equal(
    (await sql.query("SELECT COUNT(*) FROM workspace_folders")).rows[0].count,
    "0",
  );
  assert.equal(
    (await sql.query("SELECT COUNT(*) FROM folder_entry_versions")).rows[0]
      .count,
    "0",
  );
  for (const table of ["folder_tasks", "folder_task_events", "folder_history"])
    assert.equal(
      (await sql.query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count,
      "0",
    );
  console.log(
    "PASS: PostgreSQL legacy migration, service signup, persistent sessions/restart, direct import, sharing, actual MCP folder read/proposal/revoke, export and account deletion.",
  );
  fs.writeFileSync(
    path.join(root, "docs/service-validation.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        postgres: "16",
        mode: "service",
        checks: [
          "legacy-schema migration",
          "collaboration task persistence",
          "account signup and isolation",
          "persistent session after API restart",
          "owner import available without review",
          "two-party single-use code pairing",
          "MCP folder context and proposal",
          "sharing revocation",
          "export",
          "account deletion",
        ],
        backupRestore: !!(
          process.env.PG_DUMP_BIN && process.env.PG_RESTORE_BIN
        ),
        realCollaboration:
          process.env.PASSPORT_VERIFY_REAL_COLLABORATION === "true",
        realFolderClients: process.env.PASSPORT_VERIFY_REAL_CLIENTS === "true",
        externalUnverified: [
          "public HTTPS deployment",
          "live Stripe checkout and webhook delivery",
          ...(process.env.PASSPORT_VERIFY_REAL_CLIENTS === "true" ||
          process.env.PASSPORT_VERIFY_REAL_COLLABORATION === "true"
            ? []
            : ["real Codex/Claude invoking new folder tools"]),
        ],
        logDirectory: ".data/service-verify-*",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client?.close().catch(() => {});
  await stop();
  await sql?.end().catch(() => {});
  await pg.stop().catch(() => {});
  fs.closeSync(output);
}
