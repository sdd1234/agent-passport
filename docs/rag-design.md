# RAG·임베딩·벡터화 설계

## 현재 적용된 경로

`SEARCH_MODE=lexical`이 기본입니다. 실제 Codex/Claude 연결 검증도 이 모드로 수행했습니다. vector 코드는 PostgreSQL+pgvector에서 고정 테스트 벡터로 검증했지만 실제 임베딩 모델의 한국어 검색 품질은 평가하지 않았습니다.

현재 코드: [Embeddings.java](../apps/api/src/main/java/dev/passport/Embeddings.java), [MemoryService.java](../apps/api/src/main/java/dev/passport/MemoryService.java).

| 단계 | 현재 구현 |
| --- | --- |
| 저장 시점 | 사용자가 후보를 승인할 때 |
| 임베딩 입력 | 승인된 `content` 문자열 전체 |
| 단위 | `(memory_id, version)` 하나당 벡터 하나 |
| API | OpenAI `/v1/embeddings` |
| 모델 | `EMBEDDING_MODEL` 환경변수로 지정 |
| 차원 | 코드/DB 모두 1536으로 고정 |
| 질문 | 동일한 설정의 모델로 임베딩 |
| 유사도 | pgvector cosine distance를 `1 - distance`로 변환 |
| 필터 | owner, 허용 scope, project(지정 시), current, valid_to |
| 반환 개수 | 기본 8, 최대 12 |
| 제약 | 자동 청킹, 모델 버전 기록, 일괄 재색인, reranker, HNSW 없음 |

기억 원문은 암호화 저장되지만 임베딩 API에는 복호화한 텍스트를 보냅니다. 임베딩 벡터도 개인정보 특성이 남을 수 있는 데이터로 취급해야 하며 암호문이라고 설명하면 안 됩니다.

## 모델 설정

초기 설정안은 `text-embedding-3-small`/1536차원입니다. 이 모델의 기본 차원은 [OpenAI 임베딩 문서](https://developers.openai.com/api/docs/guides/embeddings)에 명시되어 있습니다. 모델 선택의 적합성은 별도 평가 대상입니다.

```dotenv
SEARCH_MODE=vector
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
DATABASE_URL=jdbc:postgresql://127.0.0.1:5432/passport
DATABASE_USER=passport
DATABASE_PASSWORD=...
```

H2에서는 vector를 사용할 수 없습니다. 이 설정은 블록체인이나 실제 CLI 로그인과 독립적입니다. 실제 CLI가 Claude여도 저장/검색 임베딩은 Passport 백엔드에서 같은 모델로 처리합니다.

현재는 승인 트랜잭션 중 동기적으로 임베딩을 호출합니다. 실패하면 승인도 롤백되어 후보가 남습니다. 재시도·배치 처리 worker는 없습니다. 긴 호출이 승인 처리 지연으로 이어질 수 있습니다.

## 현재 검색 점수

```text
score = 0.55 × similarity
      + 0.15 × recency
      + 0.15 × importance
      + 0.10
      + 0.05 × confidence
```

- vector 모드 similarity: cosine similarity.
- lexical 모드 similarity: 공백으로 나눈 질문 단어가 content/key에 포함되는 비율.
- recency: 저장 시각 기준 30일 규모 지수 감쇠. 원문 발생 시각/사실의 유효성과 동일하지 않음.
- 0.10은 현재 공통 가산점. 실제 project match score가 아님. 프로젝트는 별도 필터로 처리.
- confidence/importance는 MCP 경로에서 고정값이므로 자동 평가 점수로 표시하면 안 됨.

현재 vector 모드는 lexical 점수를 함께 합치는 BM25+dense hybrid가 아닙니다. dense+metadata 정렬입니다. 낮은 관련도 결과를 제외하는 최소 점수 정책도 아직 없습니다. SQL 후보 유사도를 구한 뒤 앱에서 후보를 정렬하며 대규모 ANN 검색 최적화는 없습니다.

## 추가 설계: 벡터화 단위

**독립적으로 수정·삭제·승인·권한 부여할 수 있는 사실 하나를 한 기억으로 만든다.** 현재 이 정책을 자동 강제하는 파서는 없습니다.

예: "백엔드는 Spring Boot, DB는 PostgreSQL, 설명은 한국어"는 backend 결정, database 결정, language 선호의 3개 기억으로 나눕니다. 한 기억에 다른 Scope의 내용을 섞지 않습니다.

임베딩 텍스트 후보는 아래처럼 최소 의미 맥락을 포함한 안정적 형식으로 만들 수 있습니다. 현재는 content만 입력하므로 이 포맷은 추가 설계입니다.

```text
유형: 프로젝트 결정
대상: 백엔드 프레임워크
내용: Agent Passport 백엔드는 Spring Boot를 사용한다.
```

- 실제 project/owner/scope/권한은 metadata 필터에 남김. 텍스트의 프로젝트 언급으로 권한을 대신하지 않음.
- 모호한 대명사를 해소하되 원문에 없는 사실을 만들지 않음.
- 기술명/식별자는 원형을 보존하고 같은 key/value의 정규화 규칙을 고정.
- 버전 번호·검색 시각처럼 의미가 없는 가변 필드는 임베딩 텍스트에 넣지 않음.
- 입력 텍스트와 정규화 버전을 기록해 재현 가능한 재색인이 가능하게 함.

짧은 사실에는 문자 수 기준 분할보다 의미 단위 분리가 우선입니다. 긴 문서 importer를 추가할 때는 제목/문단/코드 구조를 유지한 청킹을 별도로 구현합니다. 300~500 tokens, 필요한 경우 약 50 tokens overlap은 초기 평가 후보일 뿐 확정된 최적값이 아닙니다. 문서 조각을 곧바로 확정된 사용자 사실로 승격하지 않습니다.

## 추가 설계: 모델 관리와 재색인

현재 DB는 모델 ID를 기록하지 않으므로 환경변수만 다른 모델로 바꾸면 같은 1536차원이어도 호환되지 않는 벡터가 섞일 수 있습니다. **모델 교체를 현재 지원 기능으로 안내하지 않습니다.**

추가할 정보:

- embedding model ID, dimensions, normalization/chunking version
- embedding input hash, 생성 시각, indexing status
- memory version 참조와 활성 인덱스 세대

전환 과정:

1. 새 모델/포맷으로 별도 인덱스 세대 생성.
2. 승인된 current 데이터부터 재색인, 원문 삭제/철회를 작업 시점에 재확인.
3. 실패/누락을 추적하고 전체 coverage 검사.
4. 질의 임베딩 설정과 인덱스 세대를 함께 전환.
5. 평가 통과 후 구 인덱스 정리. 실패 시 구 세대로 복귀.

현재는 기존 H2 데이터 이전·일괄 재색인 기능이 없습니다. 단순히 같은 내용을 다시 저장하면 duplicate가 되므로 재색인을 보장하지 않습니다. 새 DB로 vector 기능을 검증하는 것과 기존 데이터의 운영 전환을 구분해야 합니다.

## 추가 설계: retrieval와 컨텍스트

1. 인증/권한/유효기간 필터를 우선 적용.
2. key/기술명 exact·lexical 검색과 dense 검색에서 후보 확보.
3. 초기에는 RRF 같은 후보 결합 방식과 단순 가중 합을 비교 평가.
4. 버전 중복 제거, query별 relevance 검사, 필요할 경우 reranker.
5. 토큰 예산 내 기억을 출처·버전·근거 상태와 함께 조립.
6. 관련된 승인 기억이 없으면 빈 결과와 이유를 반환.

HNSW 도입은 데이터가 많아져 exact scan의 성능 문제가 측정된 뒤 진행합니다. 필터와 ANN을 함께 쓸 때 Recall 저하를 별도로 검사해야 합니다. pgvector 지원 연산은 [공식 저장소](https://github.com/pgvector/pgvector)를 참고합니다.

## 평가와 완료 기준

- 기획서의 retrieval 질문 30개 이상을 사람이 작성하고 기대 memory ID를 라벨링.
- 표현만 다른 한국어, 기술명, 부정문, 오래된 결정, 관련 없음, scope 차단을 포함.
- Recall@5, 관련 없음 오반환률, stale version 노출률, unauthorized exposure, P50/P95 latency 측정.
- 현재 lexical 결과를 기준선으로 남기고 dense/hybrid/reranker를 동일 데이터로 비교.
- Recall ≥90%, P95 <1.5초는 기획서 목표이며 달성 여부 미검증.
- 원문/민감 scope의 외부 임베딩 허용 정책과 로컬 모델 대체 경로는 별도 구현 필요.
