# Architecture

React 대시보드와 MCP 클라이언트는 Spring Boot API를 사용합니다. 개별 계정 세션과 에이전트 토큰을 구분하고 모든 권한은 서버 DB에서 검사합니다. 데모는 H2, PC 서비스는 PostgreSQL에 저장합니다. 블록체인이나 지갑은 사용하지 않습니다.

폴더 공유는 서버가 12자리 코드를 발급한 뒤 받는 계정이 입력하여 대기하고, 소유자가 상대 계정과 같은 코드를 확인하면 완료됩니다. 10분 만료, 코드 해시 저장, DB 행 잠금과 트랜잭션으로 중복 연결 방지, 영속 시도 제한, 요금제 한도 검사를 적용합니다. 웹은 대기 상태를 주기적으로 조회합니다. 서버가 두 계정을 연결하며 P2P 파일 전송이나 하드웨어 인증을 수행하지 않습니다.

Owner sessions are only used for owner UI actions. Bearer credentials identify exactly one registered owner/agent; the API never trusts a user-supplied agent ID to override a credential. Default permission is deny. All agent retrieval paths, including version history and MCP tools, enforce READ. Proposals and updates enforce WRITE. Owner approval cannot be performed with an agent token.

Memory versions are append-only through the API. A unique `(owner, project, scope, canonical_key)` selects the canonical item. Approvals compare the proposal's expected version under a transaction. The current version pointer advances while old version content/hash/source/time remain intact. Conflicting and sensitive proposals remain outside retrieval until the owner approves. Deletion explicitly removes content-bearing versions, proposals and embeddings.

권한과 공유 철회는 각 요청의 DB 검사에 반영됩니다. 소유자 승인 전에는 수신자에게 폴더 접근 권한이 없습니다. 기존 완료된 공유는 업그레이드 후 유지되지만 이전 초대 링크는 무효화합니다.

원문과 제안 JSON은 AES-256-GCM으로 암호화하며 에이전트 토큰은 해시만 저장합니다. 기존 Flyway 마이그레이션과 사용하지 않는 과거 앵커 테이블은 데이터 호환성을 위해 보존하지만 해당 기능과 API는 제공하지 않습니다.

The pgvector path performs SQL owner/scope/project/current/validity filtering, computes cosine similarity, then applies metadata ranking. The demo uses lexical similarity instead. The API context assembler limits provider input to 16,000 characters of memory JSON. Provider requests do not send older chat history; each answer is based on the present question and freshly authorized context.

The initial project uses synchronous indexing during approval so a failed embedding cannot silently create an unindexed approved version. A worker queue is a future throughput improvement. External provider calls have connect/request timeouts and do not fall back silently to a fake result.
