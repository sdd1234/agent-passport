import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
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
} finally {
  await pg.stop();
}
