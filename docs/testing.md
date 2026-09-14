# Test coverage

- Java integration: cross-agent recall/revoke/regrant/expiry, conflict history and optimistic concurrency, sensitive approval, owner isolation, impersonation, owner-only grants, CSRF origin/header, SIWE replay, content encryption/deletion, salted root determinism.
- Solidity on local Ganache EVM: default deny, invalid masks, events, grant, cross-owner isolation, revoke, regrant, exact expiry boundary, immutable owner-scoped anchors.
- Playwright (3 scenarios): GPT creates two new memories with verified source, owner approves, fresh Claude recalls; owner UI approval → Claude recall → revoke → deny → regrant → allow; manual memory proposal/approval; page reload; 390px mobile overflow.
- MCP SDK client: actual initialization, tool discovery, denied query, propose/approve/search, revoked history request.
- PostgreSQL + pgvector: actual database and vector extension, SQL cosine ranking with **synthetic vectors** replacing the paid embedding API, scope/project filters and vector deletion.
- Live mode integration: actual Java server + PostgreSQL + local EVM + EOA SIWE signature + successful consent receipt + credential search + direct contract revoke + regrant + anchored root + forged expiry rejection.

## Commands

Use README commands for the ordinary tests. To reproduce the additional PostgreSQL/vector/live integration on Linux x64, `embedded-postgres` is pinned as a development dependency. The supplied environment has the Ubuntu pgvector extension extracted into `.tools/pgvector`; nothing is installed system-wide.

```bash
mkdir -p .tools/pgvector
cd .tools/pgvector
apt-get download postgresql-16-pgvector
for p in *.deb; do dpkg-deb -x "$p" .; done
cd ../..
cp .tools/pgvector/usr/lib/postgresql/16/lib/vector.so node_modules/@embedded-postgres/linux-x64/native/lib/postgresql/
cp .tools/pgvector/usr/share/postgresql/16/extension/vector* node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension/
node scripts/test-integration.mjs
```

This starts isolated services on ports 55439, 18545 and 18080; it shuts them down afterward. Database and chain are test-only. The standard UI demo stays on 5173/8080. No paid provider requests occur in this integration test. On other operating systems, run equivalent tests with PostgreSQL/pgvector containers and the configured Java test environment.

Browser dependencies missing on this WSL were added with `apt-get download libnspr4 libnss3` + `dpkg-deb -x`, and selected using `LD_LIBRARY_PATH`. On a normal workstation Playwright's documented browser dependency installer may be used instead.

Real OpenAI/Anthropic generation/extraction, live embedding quality and public-testnet confirmations still require configured external credentials. These are deliberately not included in the local pass count or represented as achieved product KPIs.

## 추가 실제 클라이언트 검증

Codex CLI와 Claude Code를 실제로 실행해 양방향 표식 저장/조회 및 두 클라이언트의 revoke 차단을 검증했습니다. [실제 클라이언트 결과](real-client-results.json)와 [재현 안내](real-clients.md)를 참고하세요. 기존 단위/MCP SDK 테스트와 별도로 실제 로그인된 모델을 호출했습니다.
