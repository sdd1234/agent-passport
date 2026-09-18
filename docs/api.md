# API

Base: `http://127.0.0.1:8080/api`. JSON requests. Owner mutations require a session cookie and `X-Passport-Request: 1`; the configured Origin must match if present. Agent calls use `Authorization: Bearer <agent token>`. Credentials belong to one agent and owner.

| Method/path | Purpose |
| --- | --- |
| GET /health | demo/service, provider configuration flags; no secrets |
| POST /auth/demo | explicit demo-only local login |
| POST /auth/logout | invalidate session |
| GET /me | current owner |
| GET/POST /agents | list/register; POST `{provider,name}`, one-time token |
| DELETE /agents/{id} | remove registered credential |
| GET /scopes | development, personal, research |
| GET /memories | owner explorer; optional project/scope/status filters |
| GET /memories/{id} | canonical item + versions; owner or authorized agent |
| GET /memories/{id}/versions | authorized history |
| POST /memories/propose | durable memory candidate, no implicit approval |
| PATCH /memories/{id} | `{content,expectedVersion}` → proposal |
| DELETE /memories/{id} | owner deletion of content/versions/candidates/embeddings |
| POST /memories/search | `{query,scope,project?,topK?,agentId?}`; owner Playground supplies owned agentId, token calls use bound agent |
| GET /permissions | effective bits and expiry per agent/scope |
| POST /permissions/grant | `{agentId,scope,bits,expiresAt}` |
| POST /permissions/revoke | same shape, bits forced to zero |
| GET /conflicts | pending new/conflicting proposals |
| POST /conflicts/{id}/resolve | owner `{accept:true/false}` |
| POST /chat | owner `{agentId,message,scope,project,extract,live}` |
| GET /audit | newest 200 owner audit events |
| GET /export | schemaVersion 1, memories and versions |
| POST /demo/seed | idempotent starter dataset for empty demo workspace |

Proposal example:

```json
{
  "canonicalKey": "architecture.backend.framework",
  "content": "백엔드는 Spring Boot를 사용합니다.",
  "scope": "development",
  "project": "agent-passport",
  "type": "decision",
  "confidence": 0.96,
  "importance": 0.9,
  "validTo": 0
}
```

`validTo` is epoch milliseconds (0 = no expiry). Permission `expiresAt` is epoch seconds (0 = no expiry). READ=1, WRITE=2, both=3. The source agent is assigned by authenticated identity, never by trusting the supplied proposal field.

Denied retrieval returns HTTP 403 `{ "code": "MEMORY_SCOPE_DENIED" }`. Stale update/approval returns 409. Missing provider config returns 503; provider errors return 502. API and UI do not claim these failed requests succeeded.


## 계정과 일회용 공유

| Method/path | Purpose |
| --- | --- |
| POST /account/register, /account/login | `{username,password}` 계정 가입/로그인 |
| POST /account/recover | `{username,password,recoveryCode}` 비밀번호 재설정 |
| POST /account/logout | 세션 무효화 |
| POST /pairings | 소유자 `{folderId,role}` → `{id,code,expiresAt}`; 코드는 12자리, 10분 유효 |
| POST /pairings/join | 받는 계정 `{code}` → `{id}`; 아직 폴더 접근 불가 |
| GET /pairings/{id} | 양쪽 계정만 상태/상대 계정 확인. 코드 해시는 반환하지 않음 |
| POST /pairings/{id}/confirm | 소유자 `{code}` → `{folderId}`; 받는 계정 입력 후 권한 부여 |
| DELETE /pairings/{id} | 소유자 코드 취소 |
| POST /folders/{id}/members | 이미 공유한 멤버의 권한만 변경. 신규 공유에는 pairing 필요 |
| DELETE /folders/{id}/members/{userId} | 공유·해당 멤버의 에이전트 허용·경로 매핑 철회 |

이전 지갑/SIWE/앵커/초대 링크 API는 제거했습니다. 코드 발급·입력·확인·취소 요청은 IP 기반 10분당 30회 제한을 공유하며 DB에 저장해 재시작으로 초기화되지 않습니다. 조회는 제한에 포함하지 않습니다. 서버가 발급한 코드는 DB에 SHA-256 해시만 저장하며 한 번만 공유 완료할 수 있습니다. 같은 폴더에 재발급하면 이전 미완료 코드는 취소됩니다. 완료된 권한은 코드 만료와 별개이며 명시적으로 철회해야 합니다.
