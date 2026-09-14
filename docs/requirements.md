# 기획서 23쪽 구현 대응표

전체 추출문: [기획서-전체.txt](기획서-전체.txt). 그림을 포함한 제품 설계를 기준으로 아래 범위를 구현했습니다.

| PDF | 요구사항 | 구현/확인 |
| --- | --- | --- |
| 1–4 | 공급자 독립 기억, 사용자 소유, 최소 권한 | owner namespace + GPT/Claude/MCP 등록 + 서버 permission gate |
| 4 | 실제 공급자 2개 handoff, 정량 KPI | API adapter 구현. 실제 Codex/Claude Code의 MCP 양방향 handoff 검증. 직접 API adapter·정량 평가셋 성능은 미검증 |
| 5–6 | Explorer, Matrix, Playground, Inbox, Audit | React 반응형 5개 화면과 실제 API 동작, 데스크톱/모바일 Playwright 검증 |
| 6 | 기억 추출·저장·검색·버전 | JSON 추출 검증 → 후보 → 소유자 승인 → immutable version |
| 6 | 자동/수동 승인 정책 | MVP는 모든 후보 수동 승인. 민감 scope도 자동 저장 없음 |
| 7–8 | React, Spring Boot, PostgreSQL/pgvector | 모두 구현. H2를 별도 로컬 데모 fallback으로 제공 |
| 8–9 | MCP 8개 도구, adapter | stdio SDK 서버 8개 도구, 실제 MCP client 연결 검증. Remote HTTP/OAuth 미포함 |
| 9–10 | canonical key, confidence, importance, TTL | key 검증/중복 억제/importance 컷오프/유효기간 필터 구현. key 자동 정규화는 LLM 출력 계약으로 제한 |
| 10 | hybrid ranking | vector mode: pgvector cosine + recency/importance/project/source confidence. demo: lexical 대체 |
| 11 | same/update/contradiction/coexist | same 중복은 억제. 다른 값은 모두 사람에게 검토 요청, 승인 시 버전 전환. LLM judge/자동 관계 판정은 미포함 |
| 11–12 | READ/WRITE, grant/revoke/expiry | Solidity owner namespace, bitmask, expiry boundary, 이벤트, actual receipt 검증 |
| 12 | scope hash 프라이버시 | 단순 keccak(scope)보다 강화: owner salt + owner + scope. 사전 대입 공격 완화 |
| 12 | Merkle root anchor | 버전 hash + owner salt → 정렬 pair Merkle tree → 지갑 root 기록, receipt/state 확인 |
| 13–14 | ERD, API | users/agents/permissions/memories/versions/proposals/audit/anchors/optional embeddings. scope는 고정 3개 열거형. 대화 전문 DB는 최소화 원칙에 따라 저장하지 않음 |
| 14–15 | SIWE/session, 서버 secret, 암호화 | nonce/domain/URI/chain/time가 포함된 서버 생성 메시지 검증, 재사용 거절, HttpOnly/SameSite 세션, AES-GCM |
| 15 | 위조 Agent, prompt injection | credential hash에 owner/agent 바인딩. client sourceAgent 무시. 기억은 untrusted data, 코드 레벨 권한 강제 |
| 15 | 캐시 stale revoke 방지 | live mode는 매 요청 온체인 조회. event worker/cache 최적화 대신 단순하고 검증 가능한 구현 |
| 15–16 | 배포/테스트 | Compose 웹/API/Postgres; 실제 DB와 EVM 통합, Java·Solidity·MCP·브라우저 테스트 |
| 16 | Gold evaluation 50/30/20 | 해당 규모의 사람 라벨링 평가셋은 미작성. 자동 E2E와 보안/DB 검증을 평가 성능으로 대체 표시하지 않음 |
| 17 | 90초 7단계 시연 | README와 브라우저 테스트로 재현 |
| 18–20 | 사업모델/로드맵 | 기술 구현의 제품 맥락으로 반영. 결제, 조직, DID/VC 등 확장 범위 미포함 |
| 21–22 | memory search/deny API, optimistic version | 실제 JSON API/403/409, source/version/current provenance |
| 22 | Definition of Done | 로컬 핵심 경로 충족. 실제 Codex/Claude MCP handoff 검증 완료. 직접 API adapter와 공개 테스트넷 실연은 별도 자격증명 설정 후 검증 필요 |
| 23 | 참고자료/API 재검증 | 공식 문서 확인 후 구현, references.md 참고 |

## 정확한 제한

- MVP 코드와 로컬 실행 검증을 제공하며 서비스 운영 완료/보안 감사를 주장하지 않습니다.
- 삭제는 기억 버전·후보·임베딩 원문을 제거합니다. 기존 감사 metadata/체인 root는 남으며 오프라인 백업 삭제는 운영자의 보존 정책 대상입니다.
- DB의 내용과 제안 payload는 AES-GCM으로 암호화됩니다. canonical key, project, scope, source ID, embedding 등 검색 metadata는 DB에 존재합니다. 전체 디스크/백업 암호화와 HTTPS는 배포 환경에서 구성해야 합니다.
- 감사 로그는 앱 수준에서 추가만 가능합니다. DB 관리자에 대한 불변성 보장은 체인에 앵커링한 root/권한 이벤트에 한정됩니다.
- SIWE는 EOA 지갑 서명만 지원합니다. 스마트컨트랙트 지갑 ERC-1271 검증, 계정 복구, multi-instance session store는 후속 범위입니다.
- 만료/현재 상태는 요청 시 필터링합니다. background retention worker, HNSW 최적화, event reorg 처리는 후속 범위입니다.

## 추가 설계 문서

기획서 검토 후 질문한 데이터 파싱/저장, 선별 기준, RAG 단위, 체인 활성화, 긴 세션 대책은 [전체 문서 안내](README.md)에 정리했습니다. 추가 설계는 구현 완료 상태가 아닙니다. 특히 [현재 적용 상태](current-state.md)를 기준으로 구현 범위를 판단하세요.
