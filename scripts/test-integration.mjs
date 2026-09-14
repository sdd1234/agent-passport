import EmbeddedPostgres from "embedded-postgres";
import ganache from "ganache";
import {
  JsonRpcProvider,
  ContractFactory,
  Wallet,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { compile } from "../contracts/compile.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url).pathname;
const pg = new EmbeddedPostgres({
  databaseDir: root + ".data/integration-pg",
  user: "passport_test",
  password: "local-test-only",
  port: 55439,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const chain = ganache.server({
  logging: { quiet: true },
  chain: { chainId: 31337 },
  wallet: { totalAccounts: 3 },
});
let apiProcess;
function child(command, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    p.stdout.on("data", (b) => (output += b));
    p.stderr.on("data", (b) => (output += b));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    );
  });
}
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("passport_test");
  const sql = pg.getPgClient("passport_test");
  await sql.connect();
  await sql.query("CREATE EXTENSION vector");
  await sql.end();
  await child(
    "bash",
    [
      "-c",
      "source scripts/java-env.sh; mvn -q -f apps/api/pom.xml -Dtest=PgVectorIntegrationTest test",
    ],
    {
      RUN_PG_TESTS: "true",
      APP_MODE: "demo",
      SEARCH_MODE: "vector",
      DATABASE_URL: "jdbc:postgresql://127.0.0.1:55439/passport_test",
      DATABASE_USER: "passport_test",
      DATABASE_PASSWORD: "local-test-only",
    },
  );
  console.log(
    "PASS: PostgreSQL + pgvector SQL ranking, scope/project filters, deletion (synthetic embeddings, no paid API)",
  );
  await child(
    "bash",
    [
      "-c",
      "source scripts/java-env.sh; mvn -q -f apps/api/pom.xml -DskipTests package",
    ],
    {},
  );
  await chain.listen(18545, "127.0.0.1");
  const provider = new JsonRpcProvider("http://127.0.0.1:18545");
  const key = Object.values(chain.provider.getInitialAccounts())[0].secretKey;
  const owner = new Wallet(key, provider);
  const artifact = compile();
  const contract = await new ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    owner,
  ).deploy();
  await contract.waitForDeployment();
  const log = fs.openSync(root + ".data/live-integration.log", "w");
  apiProcess = spawn(
    "bash",
    ["-c", 'source scripts/java-env.sh && exec java -jar apps/api/target/api-0.1.0.jar'],
    {
      cwd: root,
      env: {
        ...process.env,
        APP_MODE: "live",
        PORT: "18080",
        SEARCH_MODE: "lexical",
        DATABASE_URL: "jdbc:postgresql://127.0.0.1:55439/passport_test",
        DATABASE_USER: "passport_test",
        DATABASE_PASSWORD: "local-test-only",
        MEMORY_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
        EVM_RPC_URL: "http://127.0.0.1:18545",
        REGISTRY_ADDRESS: await contract.getAddress(),
        CHAIN_ID: "31337",
      },
      stdio: ["ignore", log, log],
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:18080/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  let cookie = "";
  async function request(path, body, token) {
    const res = await fetch("http://127.0.0.1:18080/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Passport-Request": "1",
        ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.headers.get("set-cookie"))
      cookie = res.headers.get("set-cookie").split(";")[0];
    const data = await res.json();
    return { status: res.status, data };
  }
  const nonce = await request("/auth/siwe/nonce", { address: owner.address });
  const signature = await owner.signMessage(nonce.data.message);
  assert.equal(
    (
      await request("/auth/siwe/verify", {
        message: nonce.data.message,
        signature,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/auth/siwe/verify", {
        message: nonce.data.message,
        signature,
      })
    ).status,
    401,
  );
  const a = (
      await request("/agents", { provider: "openai", name: "GPT live test" })
    ).data,
    b = (
      await request("/agents", {
        provider: "anthropic",
        name: "Claude live test",
      })
    ).data;
  const permissions = (await request("/permissions")).data;
  const permission = permissions.find(
    (p) => p.agentId === b.id && p.scope === "development",
  );
  const p = (
    await request("/memories/propose", {
      canonicalKey: "architecture.backend",
      content: "Spring Boot via real PostgreSQL",
      scope: "development",
      project: "integration",
      type: "decision",
      confidence: 1,
      importance: 1,
      validTo: 0,
    })
  ).data;
  assert.equal(
    (await request(`/conflicts/${p.id}/resolve`, { accept: true })).status,
    200,
  );
  const query = {
    query: "backend",
    scope: "development",
    project: "integration",
    topK: 5,
  };
  assert.equal((await request("/memories/search", query, b.token)).status, 403);
  const connected = contract.connect(await provider.getSigner(0));
  let tx = await connected.grantAccess(
    permission.agentHash,
    permission.scopeHash,
    1,
    0,
  );
  await tx.wait();
  assert.equal(
    (
      await request("/permissions/grant", {
        agentId: b.id,
        scope: "development",
        bits: 1,
        expiresAt: 0,
        txHash: tx.hash,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/memories/search", query, b.token)).data.memories[0]
      .content,
    "Spring Boot via real PostgreSQL",
  );
  assert.equal(
    (
      await request("/permissions/grant", {
        agentId: b.id,
        scope: "development",
        bits: 1,
        expiresAt: 9999999999,
        txHash: tx.hash,
      })
    ).status,
    403,
  );
  tx = await connected.revokeAccess(permission.agentHash, permission.scopeHash);
  await tx.wait();
  assert.equal((await request("/memories/search", query, b.token)).status, 403);
  assert.equal(
    (
      await request("/permissions/revoke", {
        agentId: b.id,
        scope: "development",
        bits: 0,
        expiresAt: 0,
        txHash: tx.hash,
      })
    ).status,
    200,
  );
  tx = await connected.grantAccess(
    permission.agentHash,
    permission.scopeHash,
    1,
    0,
  );
  await tx.wait();
  assert.equal((await request("/memories/search", query, b.token)).status, 200);
  const anchor = (await request("/anchors", {})).data;
  tx = await connected.anchorMemoryRoot(anchor.batchId, anchor.root);
  await tx.wait();
  assert.equal(
    (
      await request("/anchors/confirm", {
        batchId: anchor.batchId,
        txHash: tx.hash,
      })
    ).status,
    200,
  );
  console.log(
    "PASS: live-mode SIWE + replay denial + PostgreSQL + wallet grant + credential search + direct on-chain revoke + regrant + salted Merkle anchor + forged expiry rejection",
  );
  fs.writeFileSync(
    root + "docs/integration-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        postgres: "16",
        pgvector: "0.6.0",
        vectorEmbeddings: "synthetic test vectors, not real OpenAI embeddings",
        chain: "local Ganache EVM 31337",
        liveModeE2E: "passed",
        paidProviderAPIs: "not invoked",
        publicTestnet: "not deployed",
      },
      null,
      2,
    ),
  );
} finally {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
    await new Promise((r) => apiProcess.once("exit", r));
  }
  await chain.close().catch(() => {});
  await pg.stop().catch(() => {});
}
