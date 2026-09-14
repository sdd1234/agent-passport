import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
const base = process.env.PASSPORT_API_URL || "http://127.0.0.1:8080";
let cookie = "";
async function api(path, body, method) {
  const r = await fetch(base + "/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-Passport-Request": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
assert.equal(
  (await api("/health")).mode,
  "demo",
  "Run MCP smoke test only against the local demo.",
);
await api("/auth/demo", {});
const agent = await api("/agents", {
  provider: "mcp",
  name: "MCP automated test",
});
const client = new Client({ name: "passport-test", version: "0.1.0" });
let memoryId;
try {
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["apps/mcp-server/dist/index.js"],
      env: {
        ...process.env,
        PASSPORT_API_URL: base,
        PASSPORT_AGENT_TOKEN: agent.token,
      },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 8);
  const denied = await client.callTool({
    name: "search_memory",
    arguments: { query: "MCP", scope: "development" },
  });
  assert.equal(denied.isError, true);
  await api("/permissions/grant", {
    agentId: agent.id,
    scope: "development",
    bits: 3,
    expiresAt: 0,
  });
  const proposed = await client.callTool({
    name: "save_memory",
    arguments: {
      content: "MCP protocol roundtrip verified",
      canonical_key: "test.mcp." + Date.now(),
      scope: "development",
      project: "mcp-test",
      type: "decision",
    },
  });
  const proposal = JSON.parse(proposed.content[0].text);
  assert.equal(proposal.state, "pending");
  const approved = await api(`/conflicts/${proposal.id}/resolve`, {
    accept: true,
  });
  memoryId = approved.memoryId;
  const result = await client.callTool({
    name: "search_memory",
    arguments: { query: "MCP", scope: "development", project: "mcp-test" },
  });
  assert.equal(
    JSON.parse(result.content[0].text).memories[0].content,
    "MCP protocol roundtrip verified",
  );
  await api("/permissions/revoke", {
    agentId: agent.id,
    scope: "development",
    bits: 0,
    expiresAt: 0,
  });
  assert.equal(
    (
      await client.callTool({
        name: "list_memory_versions",
        arguments: { memory_id: memoryId },
      })
    ).isError,
    true,
  );
  console.log(
    "PASS: MCP initialize + 8 tools + default deny + proposal + owner approval + shared search + revoked history denial",
  );
} finally {
  await client.close();
  if (memoryId) await api("/memories/" + memoryId, undefined, "DELETE");
  await api("/agents/" + agent.id, undefined, "DELETE");
}
