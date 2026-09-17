// Local-PC service host: persistent PostgreSQL + Spring API + built static web.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
process.umask(0o077);
const root = path.resolve(import.meta.dirname, ".."),
  dir = path.join(root, ".data/pc-server"),
  dist = path.join(root, "apps/web/dist");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const configPath = path.join(dir, "settings.json"),
  databaseDir = path.join(dir, "postgres");
if (!fs.existsSync(configPath)) {
  if (fs.existsSync(path.join(databaseDir, "PG_VERSION")))
    throw new Error(
      "Database exists without settings.json. Restore the original settings/encryption key before starting.",
    );
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        databasePassword: crypto.randomBytes(32).toString("base64url"),
        encryptionKey: crypto.randomBytes(32).toString("base64"),
        databasePort: 15432,
        apiPort: 8080,
        webPort: 5173,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
fs.chmodSync(configPath, 0o600);
for (const field of ["databasePort", "apiPort", "webPort"])
  if (
    !Number.isInteger(config[field]) ||
    config[field] < 1024 ||
    config[field] > 65535
  )
    throw new Error("Invalid local port configuration");
if (new Set([config.databasePort, config.apiPort, config.webPort]).size !== 3)
  throw new Error("Choose three different local ports");
for (const file of [
  path.join(dist, "index.html"),
  path.join(root, "apps/api/target/api-0.1.0.jar"),
])
  if (!fs.existsSync(file))
    throw new Error(
      "Build first: npm run build; mvn -f apps/api/pom.xml package",
    );
for (const port of [config.databasePort, config.apiPort, config.webPort])
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(new Error(`Port ${port} is busy. Stop the other server first.`)),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
const origin = `http://localhost:${config.webPort}`;
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "passport",
  password: config.databasePassword,
  authMethod: "scram-sha-256",
  port: config.databasePort,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () =>
    console.error("PostgreSQL reported an error; inspect service status."),
});
let api,
  web,
  stopping = false;
const log = fs.openSync(path.join(dir, "api.log"), "a", 0o600);
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (web) await new Promise((resolve) => web.close(resolve));
  if (api && api.exitCode === null) {
    const p = api;
    await new Promise((resolve) => {
      p.once("exit", resolve);
      p.kill("SIGTERM");
      setTimeout(() => p.kill("SIGKILL"), 8000).unref();
    });
  }
  await pg.stop().catch(() => {});
  fs.closeSync(log);
  process.exitCode = code;
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void stop());
try {
  if (!fs.existsSync(path.join(databaseDir, "PG_VERSION")))
    await pg.initialise();
  await pg.start();
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname='passport'")
      ).rowCount
    )
      await client.query("CREATE DATABASE passport");
  } finally {
    await client.end();
  }
  api = spawn(
    "java",
    ["-jar", path.join(root, "apps/api/target/api-0.1.0.jar")],
    {
      cwd: root,
      env: {
        ...process.env,
        APP_MODE: "service",
        DEPLOYMENT: "development",
        APP_ORIGIN: origin,
        COOKIE_SECURE: "false",
        TRUST_PROXY_HEADER: "false",
        BIND_ADDRESS: "127.0.0.1",
        PORT: String(config.apiPort),
        DATABASE_URL: `jdbc:postgresql://127.0.0.1:${config.databasePort}/passport`,
        DATABASE_USER: "passport",
        DATABASE_PASSWORD: config.databasePassword,
        MEMORY_ENCRYPTION_KEY: config.encryptionKey,
        SEARCH_MODE: "lexical",
      },
      stdio: ["ignore", log, log],
    },
  );
  api.on("error", () => {
    console.error("Java could not start. Check the local Java setup.");
    void stop(1);
  });
  api.on("exit", () => {
    if (!stopping) {
      console.error("API exited; inspect .data/pc-server/api.log");
      void stop(1);
    }
  });
  let ready = false;
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${config.apiPort}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("API startup failed. Inspect the local API log.");
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
  };
  web = http.createServer(async (req, res) => {
    // Keep browser cookies and the API's CSRF origin on one local address.
    if (
      req.headers.host === `127.0.0.1:${config.webPort}` &&
      ["GET", "HEAD"].includes(req.method) &&
      !(req.url === "/api" || req.url?.startsWith("/api/"))
    ) {
      res.writeHead(302, {
        Location: origin + "/",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url === "/api" || req.url?.startsWith("/api/")) {
      const headers = { ...req.headers };
      delete headers["x-passport-client-ip"];
      delete headers["x-forwarded-for"];
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: config.apiPort,
          path: req.url,
          method: req.method,
          headers,
          timeout: 30000,
        },
        (response) => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent)
          res.writeHead(502, { "Content-Type": "application/json" });
        res.end('{"code":"SERVER_UNAVAILABLE"}');
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname),
        file = path.resolve(dist, "." + pathname);
      if (!file.startsWith(dist + path.sep) && file !== dist) {
        res.writeHead(403);
        res.end();
        return;
      }
      const stat = await fsp.stat(file).catch(() => null),
        target = stat?.isFile() ? file : path.join(dist, "index.html");
      res.setHeader(
        "Content-Type",
        types[path.extname(target)] || "application/octet-stream",
      );
      res.setHeader(
        "Cache-Control",
        target.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
      );
      res.writeHead(200);
      if (req.method === "HEAD") res.end();
      else
        fs.createReadStream(target)
          .on("error", () => res.destroy())
          .pipe(res);
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  web.requestTimeout = 30000;
  web.headersTimeout = 10000;
  web.maxHeadersCount = 100;
  await new Promise((resolve, reject) => {
    web.once("error", reject);
    web.listen(config.webPort, "127.0.0.1", resolve);
  });
  console.log(
    `Agent Passport service: ${origin} (this PC only). Create your own account in the browser.`,
  );
  console.log(
    "Persistent data and encryption settings: .data/pc-server. Keep settings.json with a separate secure backup.",
  );
} catch (e) {
  console.error(e.message);
  await stop(1);
}
