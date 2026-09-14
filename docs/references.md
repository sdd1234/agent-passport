# Official implementation references

Checked during implementation on 2026-09-14. The supplied proposal's future-dated MCP release claim was not used as an implementation dependency; installed SDK and its actual documentation define this stdio surface.

- [OpenAI text generation / Responses](https://developers.openai.com/api/docs/guides/text): backend POST `/v1/responses`, `instructions`, `input`, output text blocks.
- [Anthropic Create a Message](https://platform.claude.com/docs/en/api/messages/create): server-side Messages request, system prompt and content text blocks.
- [MCP TypeScript SDK server](https://ts.sdk.modelcontextprotocol.io/server): McpServer, registerTool and StdioServerTransport.
- [ERC-4361 SIWE](https://eips.ethereum.org/EIPS/eip-4361): origin-bound sign-in message with address, URI, version, chain, nonce and timestamps.
- [pgvector](https://github.com/pgvector/pgvector): PostgreSQL vector type and cosine distance `<=>`.

No API credentials from unrelated projects or system configuration were read. Models are configured explicitly by environment variables rather than claiming every account has a specific model available.
