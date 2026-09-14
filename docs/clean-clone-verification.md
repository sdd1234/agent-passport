# GitHub 새 복제본 독립 검증

2026-09-14, private 저장소를 `/home/sinclair/agent-passport-clean-verify`에 새로 clone하고 검증했다. 기존 프로젝트의 node_modules, .tools, .data, .env, Agent 토큰, DB를 복사하지 않았다. 동일한 Ubuntu/WSL 호스트에서 실행했으며 Node/npm, 패키지 다운로드 캐시, 실제 CLI 설치와 계정 로그인은 호스트 환경을 사용했다. 별도 VM/Windows 네이티브/Docker 검증은 아니다.

## 발견한 문제와 수정

- `npm ci`가 Ganache 하위 macOS 전용 fsevents를 Linux에서 필수 패키지로 처리해 EBADPLATFORM 오류 발생. lockfile에 optional 표시를 복구했다. 수정 후 표준 `npm ci` 통과.
- 초기 설치가 기존 프로젝트의 Java 환경을 가정하는 부분 수정. 로컬 Java 우선 사용, Java 21 확인, `.tools`가 없는 경우에도 환경 스크립트가 정상 동작하도록 수정했다. Node 최소 버전 20.19를 검사한다.
- Vite와 브라우저 검증 주소를 환경 변수로 설정할 수 있도록 변경했다. 원본 서버 8080/5173과 새 복제본 서버 18081/15173을 분리했다.
- 실제 클라이언트 실행기의 health 확인이 고정 8080을 조회하던 부분을 로컬 연결 설정의 apiUrl로 변경했다. 실제 클라이언트 검증 스크립트도 PASSPORT_API_URL을 지원한다.
- PostgreSQL/EVM 통합 테스트가 `.tools/jdk-*`에만 의존하던 부분을 공통 Java 환경 스크립트 사용으로 변경했다.
- `npm run verify:local` 추가. 기존 .env를 읽지 않고 별도 포트와 새 DB를 생성하며, 브라우저/MCP 실패를 생략하지 않는다. 검증용 자식 서버는 종료 시 정리한다.

## 재현

Linux x64 / WSL, Node.js 20.19 이상, curl/tar 필요. private 저장소를 읽을 수 있는 GitHub 로그인도 필요하다.

```bash
git clone https://github.com/sdd1234/agent-passport.git
cd agent-passport
bash scripts/setup.sh
npx playwright install --with-deps chromium
npm run verify:local
```

Playwright의 OS 의존성 설치는 관리자 권한이 필요할 수 있다. 이 Ubuntu/WSL에서는 다음 방법으로 프로젝트 폴더에 필요한 라이브러리와 Chromium을 새로 받았다.

```bash
mkdir -p .tools/browser-libs
(cd .tools/browser-libs && apt-get download libnspr4 libnss3 && for p in *.deb; do dpkg-deb -x "$p" .; done)
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" \
LD_LIBRARY_PATH="$PWD/.tools/browser-libs/usr/lib/x86_64-linux-gnu" \
npm run verify:local
```

이 두 라이브러리만으로 충분한지는 OS에 따라 다르다. 기본 검증 포트는 API 18082 / 웹 15174이며, 이미 사용 중이면 실패한다. VERIFY_API_PORT / VERIFY_WEB_PORT로 변경할 수 있다. 로그와 검증용 DB는 `.data/verify-*`에 남으며 Git에서 제외된다.

PostgreSQL/pgvector + EVM 테스트는 [testing.md](testing.md)의 확장 설치 후 `npm run test:integration`으로 재현한다. 이번에도 해당 apt 패키지를 새로 받아 실행했다.

## 검증 결과

- 새 복제본 설치, 웹/MCP TypeScript 빌드, Java JAR 패키징 성공.
- Java 메모리/인증 통합 8개 통과. 기본 실행에서 PostgreSQL 전용 테스트는 생략되므로 별도 통합 명령으로 검증했다.
- Solidity 6개 하위 시나리오 통과(node 집계 7).
- Playwright 3개 시나리오 통과: 승인/조회/철회/복구, 수동 기억 저장·새로고침, GPT 시뮬레이터 후보를 Claude 시뮬레이터가 출처와 함께 조회.
- 실제 MCP SDK 초기화, 8개 도구 발견, 기본 차단, 저장 제안, 승인, 조회, 철회 후 이력 차단 통과.
- PostgreSQL16 + pgvector0.6.0 합성 벡터 검색/필터/삭제 및 로컬 EVM live-mode SIWE·권한·Merkle anchor 통합 통과. [결과](integration-results.json).

- 실제 Codex ↔ Claude도 새 DB에서 새 Agent와 토큰을 발급하여 양방향 blind 표식 조회, 출처 확인, 양쪽 권한 철회 차단을 재검증했다. 기존 CLI 로그인만 사용했으며 기존 프로젝트 토큰/DB는 사용하지 않았다. [새 검증 증거](real-client-results.json).

외부 공급자 API 키와 공개 테스트넷은 별도 설정 사항이다. 실제 임베딩 모델 품질이나 공개 체인 배포 성공을 이 결과로 주장하지 않는다. 실제 CLI 연결은 설치 및 계정 로그인이 필요하며, 저장소에 토큰을 포함하지 않는다. 새 Agent 등록 절차는 [real-clients.md](real-clients.md)를 따른다.
