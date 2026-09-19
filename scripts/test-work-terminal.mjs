import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { workTerminal } from "./lib/work-terminal.mjs";
const id = "12345678-1234-1234-1234-123456789abc";
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", r));
test("local terminal: owner/origin checks, selected folder, single session, real websocket IO and restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "passport-terminal-"));
  const api = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.cookie !== "session=owner") {
      res.writeHead(401);
      return res.end("{}");
    }
    const routes = {
      "/api/account": { owner: "owner" },
      [`/api/folders/${id}`]: { role: "owner", name: "Fixture" },
      "/api/folders/bindings": [],
      "/api/agents":
        req.method === "POST" ? { id: "agent", token: "fixture-token" } : [],
      [`/api/folders/${id}/agent-grants`]: {},
    };
    if (!(req.url in routes)) {
      res.writeHead(403);
      return res.end("{}");
    }
    res.end(JSON.stringify(routes[req.url]));
  });
  await listen(api);
  let terminal,
    child,
    launches = 0;
  const server = http.createServer((req, res) => terminal.http(req, res));
  await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  terminal = workTerminal({
    root,
    origin,
    apiPort: api.address().port,
    owner: "owner",
    spawn: (cmd, args, options) => {
      launches++;
      assert.equal(args[1], "codex");
      assert.match(args[2], new RegExp(id));
      assert.equal(options.env.PASSPORT_FOLDER_ID, id);
      assert.ok(options.cwd.endsWith("/workspace"));
      child = {
        onData(fn) {
          this.data = fn;
        },
        onExit(fn) {
          this.exit = fn;
        },
        write(data) {
          this.data(data);
        },
        resize() {},
        kill() {
          this.exit({ exitCode: 0 });
        },
      };
      return child;
    },
  });
  server.on("upgrade", terminal.upgrade);
  const call = (
    method = "POST",
    body = { folderId: id, provider: "codex" },
    headers = {},
  ) =>
    fetch(origin + "/api/local/work", {
      method,
      headers: { Origin: origin, Cookie: "session=owner", ...headers },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal(
      (await call("POST", undefined, { Origin: "https://evil.example" }))
        .status,
      403,
    );
    assert.equal((await call("POST", undefined, { Cookie: "" })).status, 403);
    assert.equal(
      (await call("POST", { folderId: id, provider: "bash" })).status,
      403,
    );
    assert.equal((await call()).status, 200);
    assert.equal(launches, 1);
    assert.equal((await call()).status, 409);
    const ws = new WebSocket(
      origin.replace("http:", "ws:") + "/api/local/work/socket",
      { headers: { Origin: origin, Cookie: "session=owner" } },
    );
    await new Promise((r, j) => {
      ws.once("open", r);
      ws.once("error", j);
    });
    const echoed = new Promise((r) =>
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.data === "hello") r();
      }),
    );
    ws.send(JSON.stringify({ type: "input", data: "hello" }));
    await echoed;
    assert.equal((await call("DELETE")).status, 200);
    ws.close();
    assert.equal((await call()).status, 200);
    assert.equal(launches, 2);
  } finally {
    terminal.stop();
    await new Promise((r) => server.close(r));
    await new Promise((r) => api.close(r));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Claude launcher keeps the user prompt outside variadic MCP config arguments", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "passport-launch-"));
  try {
    await fs.writeFile(
      path.join(dir, "claude"),
      `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/launch-client.mjs", "claude", "Read this selected folder"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    const args = JSON.parse(result.stdout),
      boundary = args.indexOf("--");
    assert.ok(boundary > args.indexOf("--mcp-config"));
    assert.deepEqual(args.slice(boundary + 1), ["Read this selected folder"]);
    assert.ok(
      JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers[
        "agent-passport"
      ],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
