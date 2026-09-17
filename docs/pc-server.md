# 내 PC / WSL을 서버로 사용하기

Windows의 이 PC와 WSL이 실행 중인 동안 앱을 서비스합니다. Docker 없이 **PostgreSQL + Spring Boot API + 빌드된 웹 화면**을 실행합니다. 개발용 Vite 서버를 서비스 서버로 사용하지 않습니다. 외부 인터넷에는 자동 공개하지 않습니다.

## 처음 설치

Linux x64/Ubuntu WSL, Node.js 20.19 이상에서 저장소의 기본 설치를 마친 뒤 실행합니다.

```bash
bash scripts/setup.sh
npm run server:install
```

PostgreSQL 클라이언트 유틸리티는 Ubuntu 패키지를 `.tools/pg-client` 아래에 풀어 설치합니다. 관리자 권한으로 시스템 패키지를 덮어쓰지 않습니다. WSL에 systemd 사용자 서비스가 활성화되어 있어야 합니다.

브라우저 주소: **http://localhost:5173**. 처음에는 빈 서비스이므로 회원가입을 하세요. 데모 로그인은 꺼져 있습니다. 기존 H2 데모 DB와 별도의 PostgreSQL DB를 사용하므로 기존 기억은 GUI 가져오기로 옮깁니다.

기본 포트는 웹 5173, API 8080, PostgreSQL 15432이며 모두 loopback에만 바인딩합니다. 다른 프로그램이 사용 중이면 시작이 실패합니다. 서비스를 멈춘 뒤 `.data/pc-server/settings.json`의 포트를 수정할 수 있습니다. 비밀번호/암호화 키 필드는 임의로 바꾸지 마세요.

## 실행과 종료

```bash
systemctl --user status agent-passport
systemctl --user restart agent-passport
systemctl --user stop agent-passport
systemctl --user start agent-passport
journalctl --user -u agent-passport -n 50 --no-pager
```

로그인 사용자 서비스로 등록되어 사용자 systemd가 시작할 때 실행되고, 프로세스가 실패하면 재시작합니다. PC가 꺼지거나 WSL을 종료하면 서비스도 중단됩니다. Windows 부팅 시 WSL 자체를 여는 작업은 별도의 Windows 설정입니다.

systemd 없이 직접 실행하려면 `npm run server:start`를 사용합니다. 등록된 서비스와 동시에 실행하면 포트 충돌이 나므로 먼저 서비스를 멈추세요.

## 데이터와 키

- `.data/pc-server/postgres/`: 실제 계정·폴더·기억·로그인 세션 DB.
- `.data/pc-server/settings.json`: 생성된 DB 비밀번호, 암호화 키, 로컬 포트. 파일 권한 600.
- `.data/pc-server/api.log`: API 실행 로그.

설정 파일을 지운 뒤 새 키로 시작하면 기존 원문을 읽을 수 없습니다. DB가 이미 있는데 설정이 없으면 서버가 시작을 거부합니다. 이 디렉터리와 백업은 Git에 포함하지 않습니다.

## 백업

서버가 실행 중일 때:

```bash
node scripts/pc-backup.mjs backup /안전한경로/passport.dump
```

기존 파일을 덮어쓰지 않습니다. `settings.json`은 별도로 안전하게 보관해야 합니다. DB 백업만으로는 암호화 원문을 복구할 수 없습니다.

복원은 기존 DB를 대체하므로 서버를 멈추고 대상과 백업을 확인한 뒤 실행합니다.

```bash
systemctl --user stop agent-passport
PASSPORT_RESTORE_CONFIRM=restore node scripts/pc-backup.mjs restore /안전한경로/passport.dump
systemctl --user start agent-passport
```

## 요금제·가입 설정

지속할 환경변수는 `.data/pc-server/service.env`에 저장하고 파일 권한을 600으로 설정한 뒤 서비스를 재시작하세요. 예: `SIGNUP_ENABLED=false`, `FREE_FOLDERS=20`. 외부 HTTPS 접속과 결제 공급자가 확정된 뒤에 Stripe 설정을 연결합니다. 현재 localhost 실행에서는 실제 결제를 활성화하지 않습니다. 키를 명령 인자나 Git에 넣지 마세요.

## 다른 작업자의 접속

현재 주소는 이 PC용입니다. 외부 작업자가 접속하려면 PC에 도달하는 HTTPS 도메인/역방향 프록시 또는 인증된 접속 경로가 추가로 필요합니다. PostgreSQL/API 포트를 인터넷에 직접 개방하지 마세요. 외부 접속 설정 시 origin과 Secure 쿠키도 함께 변경해야 하므로 현재 loopback 실행기를 그대로 인터넷에 노출하는 방식은 사용하지 않습니다.

[일반 HTTPS 배포 구성](deployment.md)은 실제 DNS/접속 경로가 정해졌을 때 적용할 수 있습니다. 구독 결제 공급자와 판매 가격은 아직 미정이며 현재 유료 결제는 비활성 상태입니다. PC 운영의 DB 업데이트·백업·가용성 관리는 운영자가 맡습니다.
