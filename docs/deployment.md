# 서비스 배포 및 운영

코드와 로컬 검증이 공개 서비스 운영을 대신하지 않습니다. 실제 서버 계정·도메인·판매 가격·결제 계정은 운영자가 설정해야 합니다. 현재 저장소는 공개 배포가 완료된 서비스 URL을 제공하지 않습니다.

## 내 PC로 우선 실행

사용자는 우선 자신의 PC를 서버로 사용할 계획입니다. [PC/WSL 서버 실행 안내](pc-server.md)를 사용하면 Docker 없이 loopback 서비스와 영속 PostgreSQL을 실행할 수 있습니다. 아래 구성은 도메인과 HTTPS 외부 접속을 준비한 뒤의 일반 서버 배포입니다.

## 배포

Linux x64 서버에 Docker Engine/Compose를 설치하고 도메인의 DNS를 서버로 연결합니다. 80/443 포트를 열고, API/DB 포트는 외부에 공개하지 않습니다.

```bash
cp .env.example .env
# .env에 PASSPORT_DOMAIN, DATABASE_PASSWORD, MEMORY_ENCRYPTION_KEY 설정
# 암호화 키 생성:
openssl rand -base64 32

docker compose --env-file .env -f infra/compose.production.yml config --quiet
docker compose --env-file .env -f infra/compose.production.yml up -d --build
```

프로덕션 구성은 `APP_MODE=service`, `DEPLOYMENT=production`, HTTPS origin, Secure/HttpOnly 쿠키를 고정하고 PostgreSQL에 영속 저장합니다. Caddy가 TLS를 처리하며 Nginx와 API는 내부 네트워크에만 있습니다. 암호화 키를 잃으면 기억을 복구할 수 없습니다. 환경변수 파일은 접근을 제한하고 Git에 넣지 마세요.

신규 가입을 닫으려면 `SIGNUP_ENABLED=false`로 재배포합니다. 로그인 세션은 서버 DB에 해시로 저장되어 API 재시작 후에도 유지되며 7일 후 만료됩니다. 인증 시도는 IP당 10분 30회로 제한합니다. `TRUST_PROXY_HEADER=true`는 제공한 Caddy→Nginx→내부 API 구성에서만 사용하세요. Caddy가 실제 접속 IP로 헤더를 덮어씁니다. API를 직접 외부에 노출하면 안 됩니다.

`GET /api/health`가 `mode:service`를 반환하는지, `/api/auth/demo`가 404인지 확인하세요. 브라우저에서 서로 다른 계정으로 가입·가져오기·공유·철회를 확인하고 외부 PC의 MCP 클라이언트를 연결합니다. 웹훅을 제외한 쓰기는 요청 헤더와 origin을 검사합니다. 요청 본문 제한은 1MiB입니다.

## DB 업그레이드

Flyway `V1__memory_base.sql`, `V2__collaboration_service.sql`이 스키마를 관리합니다. 기존 MVP DB는 baseline 0 이후 `IF NOT EXISTS` 마이그레이션으로 승격하며 기존 데이터를 유지합니다. 적용된 SQL 파일을 수정하지 말고 새 버전을 추가하세요.

업그레이드 전 백업하고, 새 버전을 별도 DB에 복원해 확인하세요. SQL 롤백을 자동으로 추측하지 않습니다. 실패한 배포는 이전 앱 이미지와 사전 백업을 이용한 복구 절차가 필요합니다.

## 백업과 복원

```bash
bash scripts/backup.sh /private/passport-20260917.dump .env
```

암호화 키는 DB 백업과 다른 안전한 위치에 따로 보관합니다. 백업 파일에는 계정의 비밀번호 해시와 세션 해시도 들어 있으므로 접근을 제한합니다. 저장소에는 넣지 않습니다.

복원은 서비스를 멈춘 뒤 빈/복구 대상 DB를 확인하고 실행합니다. 기존 DB 내용을 대체하는 명령입니다.

```bash
docker compose --env-file .env -f infra/compose.production.yml stop api web edge
PASSPORT_RESTORE_CONFIRM=restore bash scripts/restore.sh /private/passport-20260917.dump .env
docker compose --env-file .env -f infra/compose.production.yml up -d
```

운영자는 정기 백업 일정과 보존 기간, 별도 저장소 복제, 정기 복원 훈련을 설정해야 합니다. 테스트는 별도 PostgreSQL DB로 dump/restore하고 같은 암호화 키로 원문을 복원하는지 검사합니다. 실제 서버의 예약 작업이나 외부 백업 저장소를 이 저장소가 자동 생성하지는 않습니다.

## 결제 활성화

현재 구현된 공급자는 Stripe이며 실제 판매 공급자 선택은 아직 확정하지 않았습니다. 사용할 경우 운영 계정의 상품/정기 가격을 만들고 아래 값을 비밀 설정으로 넣습니다.

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`: 현재 판매할 하나의 정기 구독 가격
- `STRIPE_WEBHOOK_SECRET`

웹훅: `https://도메인/api/billing/webhook`. 이벤트는 `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`입니다. 고객 포털에서 해지 기능을 활성화합니다. Free/Pro 한도는 `.env.example`의 항목을 정식 판매 조건에 맞게 정합니다. 기존 계정과 가격을 바꾸는 작업에는 별도의 구독 이전 계획이 필요합니다.

테스트 모드에서 Checkout→웹훅→Pro 반영→포털 해지→Free 전환을 실제로 실행한 다음 운영 키로 바꾸세요. 테스트에서는 공급자 응답을 대체해 서명·중복·순서·장애를 검사했으며 실제 카드 결제나 운영 웹훅 전달은 아직 검증하지 않았습니다.

## 관측 및 점검

`docker compose ... logs api`로 시작/마이그레이션 오류를 확인합니다. 앱 로그에 토큰이나 기억 본문을 남기지 않습니다. `/api/health`로 가용성을 감시하고 DB 디스크·백업 성공·인증 오류율·결제 재확인 오류를 운영 모니터링에 연결하세요. 새 기능은 `npm run verify:local`, `npm run verify:service`로 검증합니다.

공개 배포 전 남은 환경 작업: 실제 서버/DNS/TLS 확인, 운영 결제 계정/가격 확정, 운영 백업 일정/보관소 설정, 외부 접근과 사용자 시나리오 확인. WSL에서 Docker Desktop 연결이 비활성화되어 이번 환경에서는 production Compose 전체 컨테이너를 실행하지 못했습니다.

## GitHub 자동 검증 설정

`infra/github-actions-verify.yml`은 로컬 검증 명령을 GitHub Actions에서 실행하는 템플릿입니다. 현재 로그인된 GitHub OAuth 토큰에 `workflow` 범위가 없어 `.github/workflows/verify.yml` 업로드가 거절되었습니다. 앱 소스는 업로드하고 템플릿은 보존했습니다. 워크플로 쓰기 권한이 있는 계정으로 해당 파일을 `.github/workflows/verify.yml`에 추가하면 push/PR 자동 검증이 활성화됩니다. 이번 변경의 검증 결과는 로컬 실행 결과이며 GitHub Actions 통과로 표시하지 않습니다.
