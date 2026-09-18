# 처음 사용하는 방법

목표는 **Codex에게 기억을 맡기고 → 내가 승인하고 → 새 Claude 세션에서 같은 기억을 읽는 것**입니다. 현재 환경에 준비된 연결을 기준으로 설명합니다.

## 1. Windows에서 WSL 터미널 열기

Windows Terminal의 Ubuntu/WSL 탭을 엽니다. PowerShell에서 시작한다면 먼저 다음을 실행합니다.

```powershell
wsl
```

이후 명령은 WSL에서 실행합니다.

```bash
cd /home/sinclair/agent-passport
```

## 2. 서버와 대시보드 확인

브라우저에서 [http://localhost:5173](http://localhost:5173)을 엽니다. 열리면 이미 실행 중이므로 서버를 하나 더 시작하지 않습니다.

열리지 않으면 WSL 터미널에서:

```bash
cd /home/sinclair/agent-passport
npm run dev
```

이 터미널은 켜 두세요. 웹 준비 메시지 후 API 시작까지 잠시 기다렸다가 브라우저를 새로고침합니다. 서버 확인:

```bash
curl http://127.0.0.1:8080/api/health
```

대시보드에서 **데모 시작하기**를 누릅니다. 이미 로그인되어 있으면 바로 화면이 나타납니다. 이번 실제 CLI 연결은 `demo-owner` 공간에 등록되어 있으므로 개별 계정으로 다른 공간에 들어가면 같은 기억/Agent가 보이지 않습니다.

## 3. Codex를 연결해서 실행

새 WSL 터미널을 열어 다음을 실행합니다.

```bash
cd /home/sinclair/agent-passport
npm run agent:codex
```

현재 열려 있는 이 대화에 MCP가 자동 추가되는 방식이 아닙니다. 위 명령으로 실행한 새 Codex CLI에 연결됩니다. 일반 클라이언트가 작업 공간/도구 승인을 표시하면 실제 실행 대상이 Agent Passport인지 확인합니다.

아래 요청을 복사해서 Codex에 입력하세요.

> Agent Passport의 save_memory 도구를 호출해줘. canonical_key는 demo.handoff.note, content는 "Agent Passport의 이번 시연 이름은 파란여권이다.", project는 passport-first-use, scope는 development, type은 project_fact로 저장 후보를 만들어줘. 파일 수정이나 터미널로 저장하지 말고 MCP 도구를 사용해줘.

성공하면 `pending`과 후보 ID가 표시됩니다. 아직 다른 Agent에게 검색되는 상태는 아닙니다.

## 4. 대시보드에서 승인

1. [대시보드](http://localhost:5173)에서 **검토함**으로 이동합니다.
2. `demo.handoff.note` 후보의 내용과 출처 `Codex CLI (실제)`를 확인합니다.
3. **승인하기**를 누릅니다.
4. **기억 탐색기**에서 프로젝트 필터를 `passport-first-use`로 선택하면 기억을 확인할 수 있습니다.

검토함에 바로 보이지 않으면 브라우저를 새로고침합니다. 외부 MCP 요청에 대한 화면 실시간 push는 구현되어 있지 않습니다.

## 5. Claude에서 같은 기억 검색

다른 WSL 터미널을 열어 다음을 실행합니다.

```bash
cd /home/sinclair/agent-passport
npm run agent:claude
```

Claude에 아래 요청을 입력합니다. 정답인 시연 이름은 알려주지 않습니다.

> Agent Passport의 search_memory 도구로 project=passport-first-use, scope=development에서 demo.handoff.note를 찾아줘. 이번 시연 이름이 무엇인지 저장된 내용과 source_agent를 근거로 답해줘. 파일이나 이전 대화에서 추측하지 말고 MCP로 조회해줘.

Claude가 "파란여권"을 조회하고 출처가 Codex로 저장되어 있으면 공유가 된 것입니다. Codex와 Claude 사이에 대화를 복사해서 붙여 넣을 필요가 없습니다.

## 6. 접근 차단 확인

1. 대시보드의 **접근 권한**으로 이동합니다.
2. **Claude Code (실제)** 열의 `development READ`를 끕니다. `Claude Agent`는 Playground용 별도 Agent이므로 구분하세요.
3. Claude에게 "같은 조건으로 search_memory를 다시 호출하고 이번 도구 결과를 보여줘"라고 요청합니다.
4. 도구 결과가 `MEMORY_SCOPE_DENIED`이면 서버 차단이 작동한 것입니다.
5. 사용을 계속하려면 READ를 다시 켭니다.

이미 응답으로 전달된 사실을 Claude가 대화 문맥에서 기억할 수는 있습니다. 권한 철회는 이전 전달 내용을 지우는 기능이 아닙니다. 차단 여부는 **새 MCP 호출 결과**로 확인하거나 새 클라이언트 세션에서 확인하세요.

## 7. 수정·삭제·다음 세션

- 수정: 같은 프로젝트/Scope/키로 새로운 내용을 `save_memory`로 제안 → 검토함 승인. 기존 버전은 이력에 남습니다.
- 중복: 같은 키와 정확히 같은 내용을 반복 저장하면 새 후보 대신 duplicate가 나올 수 있습니다.
- 삭제: 기억 카드 열기 → **기억 삭제** → 확인. 내용·버전·관련 후보를 제거합니다.
- 새 세션: 같은 실행기로 다시 열고 `search_memory`로 프로젝트 기억을 요청합니다. 자동 세션 요약/복원은 아직 없습니다.
- 종료: Agent 터미널은 종료해도 DB 기억이 유지됩니다. 서버 종료는 서버 터미널에서 `Ctrl+C`입니다.

## 대시보드 채팅과 실제 CLI의 차이

이번 사용 순서는 **터미널의 실제 Codex/Claude + 대시보드의 승인/권한 화면**입니다. 대시보드 Playground의 기본 응답은 시뮬레이션이며 실제 CLI 세션이 아닙니다. Playground 직접 API를 켜려면 별도 API 키·모델 설정이 필요합니다.

현재 사용에는 임베딩 API 키가 필요하지 않습니다. 기본 검색은 lexical, 권한은 서버 SQL입니다. 프로젝트 폴더 공유는 양쪽 일회용 코드 확인을 사용합니다. [서비스 사용법](service-guide.md)과 [RAG 설계](rag-design.md)를 참고하세요.

## 자주 만나는 문제

| 증상 | 확인/해결 |
| --- | --- |
| 5173 포트 사용 중 | 이미 실행된 서버를 사용. 새 `npm run dev`를 반복하지 않음 |
| Start Agent Passport 오류 | 먼저 API 서버 실행, `/api/health` 확인 |
| Missing credentials | `.data/agent-connections.json` 필요. [토큰 등록 안내](real-clients.md) 참고 |
| INVALID_CREDENTIAL | DB를 초기화했거나 해당 Agent를 삭제했는지 확인. 새 토큰 발급 후 로컬 연결 파일 갱신 |
| MEMORY_SCOPE_DENIED | 해당 **실제 CLI Agent**의 Scope READ/WRITE와 만료 확인 |
| 검색 결과가 비어 있음 | 후보 승인 여부, project/scope 일치, 현재 버전/유효기간 확인 |
| 후보가 보이지 않음 | 대시보드 새로고침, `duplicate`/`skipped` 반환 여부, 로그인 공간 확인 |
| MCP 도구가 안 보임 | 실행기에서 연 새 세션인지 확인. 변경한 MCP 코드는 `npm run build -w apps/mcp-server` 후 클라이언트 재실행 |
| 로그인 필요 메시지 | 해당 CLI에서 정상 로그인 후 재실행. Passport 토큰과 모델 서비스 로그인은 별개 |
| CHAIN_UNAVAILABLE | live 권한 모드에서 RPC/계약 설정 확인. 현재 빠른 사용 안내는 demo 기준 |

새 PC에는 ZIP의 소스만 있으므로 `bash scripts/setup.sh`, CLI 설치·로그인, Agent 등록·토큰 설정이 별도로 필요합니다. DB나 키를 지우는 방식으로 오류를 해결하지 마세요. 기존 기억을 복구하지 못할 수 있습니다.
