import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const endpoint = process.env.PASSPORT_API_URL || "http://127.0.0.1:8080";
const token = process.env.PASSPORT_AGENT_TOKEN;
if (!token)
  throw new Error(
    "PASSPORT_AGENT_TOKEN is required. Register an agent in the dashboard.",
  );
const server = new McpServer({ name: "agent-passport", version: "0.1.0" });
async function request(path: string, body?: unknown, method?: string) {
  const response = await fetch(endpoint + "/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Passport-Request": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function tool(fn: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(await fn()) }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: (e as Error).message }],
    };
  }
}
const scope = z.enum(["development", "personal", "research"]);
const proposal = {
  content: z.string().min(1).max(10000),
  canonical_key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/),
  scope,
  project: z.string().default("agent-passport"),
  type: z
    .enum([
      "decision",
      "preference",
      "project_fact",
      "profile_fact",
      "progress",
      "todo",
      "constraint",
      "summary",
    ])
    .default("decision"),
};
server.registerTool(
  "search_memory",
  {
    description:
      "Search approved shared memories. Server enforces agent-bound READ permission; denied scopes never return data.",
    inputSchema: {
      query: z.string().max(2000),
      scope,
      project: z.string().optional(),
      top_k: z.number().int().min(1).max(12).default(8),
    },
  },
  (b) =>
    tool(() =>
      request("/memories/search", {
        query: b.query,
        scope: b.scope,
        project: b.project,
        topK: b.top_k,
      }),
    ),
);
server.registerTool(
  "get_project_context",
  {
    description:
      "Get approved context for all requested scopes. Each scope must allow READ.",
    inputSchema: { project: z.string(), scopes: z.array(scope).min(1).max(3) },
  },
  (b) =>
    tool(async () => {
      const results = [];
      for (const s of b.scopes)
        results.push(
          await request("/memories/search", {
            query: b.project,
            scope: s,
            project: b.project,
            topK: 8,
          }),
        );
      return results;
    }),
);
for (const name of ["save_memory", "propose_memory"])
  server.registerTool(
    name,
    {
      description:
        "Propose a durable memory. Requires WRITE. Owner approval is required before it becomes searchable, including sensitive data.",
      inputSchema: proposal,
    },
    (b) =>
      tool(() =>
        request("/memories/propose", {
          content: b.content,
          canonicalKey: b.canonical_key,
          scope: b.scope,
          project: b.project,
          type: b.type,
          confidence: 0.85,
          importance: 0.8,
          validTo: 0,
        }),
      ),
  );
server.registerTool(
  "update_memory",
  {
    description:
      "Propose a revision with optimistic concurrency. Does not approve the proposal.",
    inputSchema: {
      memory_id: z.string().uuid(),
      content: z.string().min(1).max(10000),
      expected_version: z.number().int().positive(),
    },
  },
  (b) =>
    tool(() =>
      request(
        `/memories/${b.memory_id}`,
        { content: b.content, expectedVersion: b.expected_version },
        "PATCH",
      ),
    ),
);
server.registerTool(
  "list_memory_versions",
  {
    description:
      "List versions, requiring READ permission for this memory scope.",
    inputSchema: { memory_id: z.string().uuid() },
  },
  (b) => tool(() => request(`/memories/${b.memory_id}/versions`)),
);
server.registerTool(
  "list_scopes",
  {
    description: "List available scope names. This does not grant access.",
    inputSchema: {},
  },
  () => tool(() => request("/scopes")),
);
server.registerTool(
  "request_scope_access",
  {
    description:
      "Request owner consent. Agents cannot grant themselves permission; returns dashboard instructions.",
    inputSchema: {
      scope,
      permission: z.enum(["READ", "WRITE"]),
      ttl: z.number().int().positive().optional(),
    },
  },
  (b) =>
    tool(async () => ({
      status: "OWNER_ACTION_REQUIRED",
      ...b,
      instructions:
        "Ask the owner to open Agent Passport → 접근 권한 and approve your registered agent. This tool does not grant permission.",
    })),
);
await server.connect(new StdioServerTransport());
