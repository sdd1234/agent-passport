# 일회용 코드 공유 검증 (2026-09-18)

- `PairingIntegrationTest`: 양쪽 확인 전 접근 거부, 잘못된 코드, 제3자 선점/조회 차단, 만료, 취소, 재발급, 일회용 재사용 거부, 철회 후 재연결 차단, 시도 제한, 기존 지갑/앵커/초대 API 제거.
- `scripts/test-organizer.mjs`: 전체 본문 분류, 프로젝트 격리, 중복 방지, 긴 파일 보존.
- `eval/browser/service.spec.ts`: 파일 선택 한 번으로 자동 분류·즉시 저장한 뒤 두 독립 브라우저 계정으로 코드 발급·입력·소유자 확인·읽기 공유·철회 검증.
- `npm run verify:local`: 빌드, Java, GUI, MCP 회귀 검증.
- `npm run verify:service`: 별도 PostgreSQL에서 마이그레이션·공유·MCP·재시작 검증. 실제 CLI 및 백업/복원은 추가 설정 시 실행하며 결과 JSON의 플래그로 구분합니다.
- 기존 `integration-results.json` 등의 EVM 기록은 제거 전 역사 기록이며 현재 기능의 검증 근거가 아닙니다.

# Test coverage

- Java integration: cross-agent recall/revoke/regrant/expiry, conflict history and optimistic concurrency, sensitive approval, owner isolation, impersonation, owner-only grants, CSRF origin/header, content encryption/deletion.
- Playwright (3 scenarios): GPT creates two new memories with verified source, owner approves, fresh Claude recalls; owner UI approval → Claude recall → revoke → deny → regrant → allow; manual memory proposal/approval; page reload; 390px mobile overflow.
- MCP SDK client: actual initialization, tool discovery, denied query, propose/approve/search, revoked history request.
- PostgreSQL + pgvector: actual database and vector extension, SQL cosine ranking with **synthetic vectors** replacing the paid embedding API, scope/project filters and vector deletion.

## Commands

Use README commands for the ordinary tests. To reproduce the additional PostgreSQL/vector integration on Linux x64, `embedded-postgres` is pinned as a development dependency. The supplied environment has the Ubuntu pgvector extension extracted into `.tools/pgvector`; nothing is installed system-wide.

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

This starts isolated services on port 55439; it shuts them down afterward. The database is test-only. The standard UI demo stays on 5173/8080. No paid provider requests occur in this integration test. On other operating systems, run equivalent tests with PostgreSQL/pgvector containers and the configured Java test environment.

Browser dependencies missing on this WSL were added with `apt-get download libnspr4 libnss3` + `dpkg-deb -x`, and selected using `LD_LIBRARY_PATH`. On a normal workstation Playwright's documented browser dependency installer may be used instead.

Real OpenAI/Anthropic generation/extraction, live embedding quality still require configured external credentials. These are deliberately not included in the local pass count or represented as achieved product KPIs.

## 추가 실제 클라이언트 검증

Codex CLI와 Claude Code를 실제로 실행해 양방향 표식 저장/조회 및 두 클라이언트의 revoke 차단을 검증했습니다. [실제 클라이언트 결과](real-client-results.json)와 [재현 안내](real-clients.md)를 참고하세요. 기존 단위/MCP SDK 테스트와 별도로 실제 로그인된 모델을 호출했습니다.

- `node --test scripts/test-overview.mjs`: 원문 근거·날짜 보존, 가져온 시각을 진행일로 오인하지 않음, 미승인/코드/메타데이터 제외. 브라우저에서는 개요→출처→원문과 공유받은 계정의 조회를 확인합니다.
