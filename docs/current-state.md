# 현재 적용 상태

## 점검 결과

2026-09-14 문서화 시점에 `GET http://127.0.0.1:8080/api/health` 응답을 확인했습니다.

```json
{
  "status": "ok",
  "mode": "demo",
  "registry": "",
  "chainId": 31337,
  "providers": { "openai": false, "anthropic": false }
}
```

`chainId:31337`은 설정값입니다. `registry`가 비어 있으므로 현재 서버가 체인에 연결되어 있다는 증거가 아닙니다. `providers:false`는 Playground 직접 API 키·모델 설정 상태이며, 이미 로그인된 Codex CLI/Claude Code의 MCP 사용 가능 여부와는 별개입니다.

현재 구성은 H2 파일 DB, 로컬 SQL 권한, lexical 검색입니다. 실제 Codex·Claude 모델은 각각의 기존 로그인으로 MCP 서버를 호출했습니다.

## 적용·검증 구분

| 항목 | 구현 | 검증/현재 활성화 |
| --- | --- | --- |
| React 화면 5개 | 있음 | Explorer, Playground, 권한, 검토함, 감사 로그 검증 |
| stdio MCP 도구 8개 | 있음 | 실제 SDK client 및 실제 Codex/Claude 사용 검증 |
| Agent별 자격증명 | 있음 | token hash → owner/agent 바인딩, 위조 ID 차단 |
| 후보 저장·사용자 승인 | 있음 | 승인 전 검색 제외 검증 |
| 같은 키/내용 중복 억제 | 있음 | 정확히 같은 내용 기준, 의미 중복 병합은 없음 |
| 충돌 검토·이전 버전 보존 | 있음 | 낙관적 버전 검사, 동시 변경 충돌 거절 |
| 기억 내용 암호화 | 있음 | AES-256-GCM. 메타데이터 전체 암호화는 아님 |
| 직접 API로 기억 추출·응답 | 있음 | 별도 API-key adapter는 외부 실제 호출 미검증 |
| 일반적인 대화 자동 수집 | 없음 | Agent가 MCP를 호출한 내용만 들어옴 |
| 파일/PDF 업로드 파싱 | 없음 | 기획서를 개발 중 읽은 작업과 구분 |
| 데이터 기반 중요도 평가 | 부족 | MCP 경로 confidence=0.85, importance=0.8 고정 |
| PostgreSQL/pgvector 검색 | 있음 | 실제 SQL+고정 벡터 테스트. 현재 서버는 비활성 |
| 실제 임베딩 모델 품질 | 미검증 | 실제 API 임베딩·한국어 검색 평가 미실행 |
| Solidity registry/anchor | 있음 | 실제 로컬 EVM 배포·호출 검증. 현재 서버는 비활성 |
| 공개 테스트넷 배포 | 없음 | 배포 스크립트만 준비 |
| 대화 자동 요약·체크포인트 | 없음 | 설계 문서만 있음 |
| 새 세션 자동 복원 | 없음 | 사용자가 MCP 검색을 요청하면 공유 기억 조회 가능 |
| 모델별 토큰 예산 | 부족 | Playground만 기억 JSON 16,000자 제한 |
| 원격 HTTP MCP/OAuth | 없음 | 현재는 로컬 stdio 연결 |

## 설정은 서로 독립적

| 설정/경로 | 제어하는 것 | 자동으로 바뀌지 않는 것 |
| --- | --- | --- |
| `APP_MODE=demo/live` | 로그인·권한 검증/체인 경로 | DB 종류, 임베딩 모드, Agent 로그인 |
| `DATABASE_URL` | H2 또는 PostgreSQL | 체인과 모델 호출 |
| `SEARCH_MODE=lexical/vector` | 검색 유사도/임베딩 경로 | 블록체인 활성화 |
| Playground의 실제 API 사용 | OpenAI/Anthropic 직접 API 호출 | 외부 CLI의 로그인·모델 |
| `npm run agent:codex/claude` | 실제 CLI에 Passport MCP 추가 | 대화 전체 자동 기록·자동 승인 |

## 현재 저장 위치

로컬 실행의 작업 디렉터리는 프로젝트 루트입니다.

- 기억 DB: `/home/sinclair/agent-passport/.data/passport.mv.db`
- 개발용 암호화 키: `.data/encryption.key` (명시적 환경변수 키 사용 시 파일 생성 경로와 다를 수 있음)
- 실제 클라이언트용 토큰: `.data/agent-connections.json`
- API 로그: `.data/api.log`
- 검증용 원본 로그: `.data/real-clients/`
- PostgreSQL Compose 사용 시: `infra/docker-compose.yml`에 정의된 `postgres` Docker volume

`.data`와 `.env`는 배포 ZIP/Git에 포함하지 않습니다. ZIP은 소스·문서이며 기존 기억·로그인·토큰을 다른 PC에 복제하지 않습니다.

## 검증 결과를 읽는 방법

[실제 클라이언트 결과](real-client-results.json)는 서로 다른 새 세션에 정답 표식을 알려주지 않고 MCP로 조회했는지 검사합니다. 이 검증은 실제 모델 호출이지만 권한·저장 백엔드는 로컬 demo입니다.

[DB/체인 결과](integration-results.json)는 PostgreSQL, pgvector, 로컬 EVM과 live API를 사용했습니다. 임베딩은 고정 테스트 벡터여서 모델 검색 품질을 증명하지 않습니다.

일반 자동 테스트와 통합 테스트 통과가 운영 완료, 공개 테스트넷 배포, Recall 목표 달성을 뜻하지는 않습니다.
