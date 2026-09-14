# 실제 Codex / Claude Code 연결 검증

2026-09-14, 이 WSL에 설치된 **Codex CLI 0.154.0**과 **Claude Code 2.1.236**을 실제로 실행했습니다. 기존 로그인 세션을 사용했으며 별도의 OpenAI/Anthropic API 키를 추출하거나 복사하지 않았습니다.

**결과: 양방향 기억 공유, 출처 검증, 두 클라이언트의 권한 차단 모두 통과.** 기계적으로 검증한 증거는 [real-client-results.json](real-client-results.json)에 있습니다.

| 단계 | 실제 동작 | 결과 |
| --- | --- | --- |
| Codex 저장 | 실제 Codex가 `save_memory` 호출, 무작위 표식 제안 | pending 후보 생성 |
| 소유자 승인 | 알려진 테스트 표식만 owner API로 승인 | 검색 가능한 기억 생성 |
| Claude 조회 | 완전히 새 Claude 세션에 표식 값은 알려주지 않고 key/project만 제공 | Codex의 표식과 Codex source_agent를 MCP로 조회 |
| Claude 저장 | 실제 Claude가 새 무작위 표식을 `save_memory`로 제안 | pending 후보 생성 |
| 소유자 승인 | 테스트 표식만 owner API로 승인 | 검색 가능한 기억 생성 |
| Codex 조회 | 완전히 새 Codex 세션에 Claude 표식 값은 제공하지 않음 | Claude 표식과 Claude source_agent 조회 |
| 권한 철회 | 양쪽 development 권한을 철회한 뒤 새 세션에서 검색 | 두 클라이언트 모두 MEMORY_SCOPE_DENIED, 원문 미반환 |
| 복구 | 테스트 후 양쪽 development READ/WRITE 복구 | 재사용 가능 |

실제 도구 호출 기록을 검사했으며 shell/파일 읽기를 통한 우회 조회는 없었습니다. 다른 클라이언트가 반환해야 할 표식을 그 클라이언트 프롬프트에 넣지 않았습니다. 저장된 source_agent도 실제 등록 ID와 일치했습니다.

## 지금 다시 사용하기

서버는 `npm run dev`로 실행합니다. 새 복제본에서는 아래 자격증명과 이식 절차로 Agent를 먼저 등록하세요. Codex/Claude CLI 설치 및 각 계정 로그인도 필요합니다.

```bash
cd /home/sinclair/agent-passport
npm run agent:codex
```

다른 터미널에서는:

```bash
cd /home/sinclair/agent-passport
npm run agent:claude
```

두 실행기는 해당 실행에 Agent Passport MCP 연결을 추가합니다. 기존 전역 Codex/Claude 설정을 수정하지 않습니다. 이미 열려 있는 세션의 도구 목록은 자동으로 바뀌지 않으므로 위 명령으로 새 클라이언트를 여세요.

대시보드 [http://localhost:5173](http://localhost:5173)의 데모 공간에서 `Codex CLI (실제)`, `Claude Code (실제)`를 확인할 수 있습니다. 개발 Scope에 READ/WRITE가 있으며 personal/research는 기본 차단 상태입니다.

예시 요청:

> Agent Passport의 search_memory를 사용해서 development scope, agent-passport 프로젝트의 기술 스택을 알려줘.

기억 저장 요청은 `save_memory` → 대시보드 검토함 승인 순서입니다. 에이전트가 마음대로 승인할 수는 없습니다.

## 자격증명과 이식

토큰은 `.data/agent-connections.json`에 파일 권한 600으로 저장되어 있으며 Git/ZIP에서 제외합니다. MCP 서버 실행기가 이 파일을 읽으므로 토큰을 CLI 인자나 공유 설정에 넣지 않습니다. GitHub에서 새로 복제하거나 ZIP을 다른 환경으로 옮기는 경우 대시보드에서 새 Agent 두 개를 등록하고 필요한 권한을 부여한 뒤 다음 로컬 파일을 만드세요.

```json
{
  "apiUrl": "http://127.0.0.1:8080",
  "codex": { "token": "대시보드에서_발급한_Codex_Agent_토큰" },
  "claude": { "token": "대시보드에서_발급한_Claude_Agent_토큰" }
}
```

```bash
chmod 600 .data/agent-connections.json
```

실행기 `scripts/agent-client.mjs` → 자격증명 전달기 `scripts/mcp-client.mjs` → `apps/mcp-server/dist/index.js` → Spring API 순서로 연결됩니다.

## 재현 가능한 검증

다음 명령은 실제 로그인된 모델을 호출합니다. 표식을 저장한 다음에만 승인하며, 검증 마지막에 권한을 복구합니다. 로컬 demo 모드 전용입니다.

```bash
node scripts/check-real-clients.mjs codex-write
node scripts/check-real-clients.mjs approve
node scripts/check-real-clients.mjs claude-handoff
node scripts/check-real-clients.mjs approve
node scripts/check-real-clients.mjs codex-recall
node scripts/check-real-clients.mjs revoke
node scripts/check-real-clients.mjs claude-denied
node scripts/check-real-clients.mjs codex-denied
node scripts/check-real-clients.mjs restore
node scripts/verify-real-clients.mjs
```

원본 실행 로그는 `.data/real-clients/`에 비공개로 저장합니다. `docs/real-client-results.json`에는 검증용 표식·도구 결과만 추려 저장하고 토큰이나 계정 이메일은 포함하지 않습니다.

## 이번 검증의 범위

실제 Codex/Claude 모델이 MCP를 사용한 것은 검증했습니다. 저장소와 권한 백엔드는 기존 로컬 demo 모드(H2/SQL 권한)였습니다. 지갑·공개 테스트넷 연결 및 Playground의 API-key 기반 OpenAI Responses/Anthropic Messages adapter 검증은 이 결과와 구분합니다. 로컬 EVM과 PostgreSQL 통합 결과는 기존 [integration-results.json](integration-results.json)을 참고하세요.

설정 형식은 [Codex 공식 MCP 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)와 [Claude Code 공식 MCP 문서](https://code.claude.com/docs/en/mcp)를 확인했습니다.
