# API

Base: `http://127.0.0.1:8080/api`. JSON requests. Owner mutations require a session cookie and `X-Passport-Request: 1`; the configured Origin must match if present. Agent calls use `Authorization: Bearer <agent token>`. Credentials belong to one agent and owner.

| Method/path | Purpose |
| --- | --- |
| GET /health | demo/live, chain, provider configuration flags; no secrets |
| POST /auth/demo | explicit demo-only local login |
| POST /auth/siwe/nonce | `{address}` → exact server-generated SIWE `message` |
| POST /auth/siwe/verify | `{message,signature}` → owner session |
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
| GET /permissions | effective bits and hashed scope/agent metadata |
| POST /permissions/grant | `{agentId,scope,bits,expiresAt,txHash?}` |
| POST /permissions/revoke | same shape, bits forced to zero |
| GET /conflicts | pending new/conflicting proposals |
| POST /conflicts/{id}/resolve | owner `{accept:true/false}` |
| POST /chat | owner `{agentId,message,scope,project,extract,live}` |
| GET /audit | newest 200 owner audit events |
| POST /anchors | prepare salted Merkle root; `{}` |
| POST /anchors/confirm | `{batchId,txHash}`; live receipt and state checked |
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

`validTo` is epoch milliseconds (0 = no expiry). Permission `expiresAt` is epoch seconds (0 = no expiry), matching Solidity. READ=1, WRITE=2, both=3. The source agent is assigned by authenticated identity, never by trusting the supplied proposal field.

Denied retrieval returns HTTP 403 `{ "code": "MEMORY_SCOPE_DENIED" }`. Stale update/approval returns 409. Missing provider config returns 503; provider errors return 502. API and UI do not claim these failed requests succeeded.
