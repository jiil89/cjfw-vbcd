# 프로젝트 구조 설계 원칙 — 회의실 예약 Agent

이 문서는 `prompts/prd.txt`(PRD)와 `prompts/1-domain-definition-meeting-room-agent.md`(도메인 정의서), `supabase/migrations/`(실제 DB 스키마)에서 이미 확정된 결정사항을 바탕으로, 실제 코드를 작성할 때 따라야 할 구조 원칙을 정리한 것이다. 여기 나오는 원칙은 전부 이 프로젝트의 실제 스택(React 19 + Zustand + TanStack Query, Node.js + Express + `pg`, Vercel, Supabase, Playwright)에 한정된다 — 범용 아키텍처론을 늘어놓지 않는다.

아직 코드가 없는 상태(`prompts/prd.txt` 3번 "진행 상태" 참고)이므로, 이 문서도 실제 구현을 시작하면서 계속 다듬어가는 것을 전제로 한다.

---

## 1. 모든 스택에 공통인 최상위 원칙

- **오버엔지니어링 금지.** 지금 필요 없는 추상화(범용 플러그인 구조, 아직 안 쓰는 채널을 위한 인터페이스 등)를 미리 만들지 않는다. 예: `supabase/migrations/20260813000900_rls.sql`의 주석처럼 "지금 요구사항에 없으므로 미리 만들어두지 않는다"는 판단을 코드에도 동일하게 적용한다.
- **도메인 정의서 + PRD가 소스오브트루스.** 비즈니스 규칙(운영시간 07:00~19:00, 2시간 제한, 7일 예약 범위, 상암S시티 고정 등)은 코드에 하드코딩하더라도 그 근거를 `1-domain-definition-meeting-room-agent.md` 6번 조항 번호로 주석에 남긴다. 규칙이 바뀌면 문서를 먼저 고치고 코드를 따라 고친다 — 반대로 하지 않는다.
- **DB 스키마가 데이터 구조의 소스오브트루스.** `supabase/migrations/*.sql`이 이미 확정되어 있으므로, 애플리케이션 타입(TS 인터페이스 등)은 이 스키마에서 파생시킨다. 스키마와 다른 임의의 타입을 프론트/백엔드에서 새로 정의하지 않는다.
- **두 종류의 "비밀번호"를 코드 레벨에서도 절대 섞지 않는다.** DB가 이미 `users.encrypted_password`(CJ 사내 계정, 복호화 가능한 암호화)와 `users.app_password_hash`(이 서비스 로그인, 단방향 해시)를 분리해 놓았다. 애플리케이션 코드에서도:
  - 타입을 분리한다 (`CorporateCredential` vs `AppLoginCredential` 같은 별도 타입/모듈).
  - 취급하는 함수를 분리한다 (암호화/복호화 로직과 해시/검증 로직은 서로 다른 모듈에 두고, 한 함수가 두 종류를 같이 다루지 않는다).
  - 평문은 어떤 단계에서도 로그/응답/에러 메시지에 남기지 않는다 (도메인 정의서 6번 "[결정됨]" 조항).
- **LLM은 판단만 하고, 실행은 항상 서버 코드가 한다.** LLM(gpt-5-nano)이 하는 일은 "사용자 발화 → 어떤 도구를 어떤 인자로 호출할지 결정"까지다. 실제 CJ 시스템 호출, DB 쓰기, 검증 로직은 전부 결정론적인 서버 코드가 수행한다. LLM 응답을 그대로 실행 결과로 신뢰하지 않는다.
- **채널이 웹 챗봇 하나뿐이어도, 텔레그램을 지금 같이 설계하지 않는다.** `users.telegram_user_id` 같은 컬럼은 이미 nullable로 열려 있지만, 코드에서 텔레그램 대응 추상화(멀티 채널 어댑터 등)를 미리 만들지 않는다. 텔레그램이 실제로 추가될 때 그 시점 코드를 보고 확장한다.

## 2. 의존성/레이어 원칙

- **백엔드 내부 의존 방향을 한 방향으로 고정한다: LLM 오케스트레이션 계층 → 도구(서비스) 계층 → CJ 자동화 계층.**
  - LLM 오케스트레이션 계층: 사용자 발화를 받아 도구 호출로 변환한다. 이 계층은 "도구 계층"의 함수만 호출할 수 있고, Playwright나 `pg`를 직접 알지 못한다.
  - 도구(서비스) 계층: `checkRoom → checkStraightRoom → checkDayCountLimit → SaveReserve` 같은 예약 도메인 규칙, 선호 회의실 우선순위, 분할 예약/보상 트랜잭션 로직이 여기 있다. 이 계층이 CJ 자동화 계층과 DB 리포지토리를 호출한다.
  - CJ 자동화 계층: Playwright + `@sparticuz/chromium`으로 실제 `cjwappr.cj.net` ASMX 엔드포인트를 호출하는 가장 하위 계층. 이 계층은 예약 비즈니스 규칙(2시간 제한 등)을 모르고, 순수하게 "로그인하고 이 API를 호출한다"만 안다.
  - 역방향 의존을 만들지 않는다 — 예를 들어 CJ 자동화 계층이 LLM을 호출하거나, 도구 계층이 프롬프트 문자열을 조립하는 일은 없어야 한다.
- **프론트엔드는 CJ 자동화나 Supabase에 절대 직접 접근하지 않는다.** 4개 화면(회원가입, 로그인, Admin 패널, 웹 챗봇 UI) 모두 백엔드 API(Express, Vercel Functions)를 거쳐서만 데이터를 주고받는다. 예외는 `rooms` 테이블 등 RLS가 `anon`에게 공개 SELECT를 열어준 극히 일부(`supabase/migrations/20260813000900_rls.sql`의 `rooms_public_read_bookable`, `account_registration_requests_public_insert`)뿐이며, 이 두 경우도 지금 아키텍처가 이미 그렇게 정해놓은 것이지 임의로 넓히지 않는다.
- **CJ 사내 계정 자격증명 복호화는 CJ 자동화 계층 안에서만 일어난다.** 다른 계층(도구 계층, API 라우트, 프론트엔드)은 복호화된 CJ 비밀번호를 절대 넘겨받지 않는다.
- **재로그인 전략을 계층 경계에 반영한다.** 도메인 정의서 9번의 "세션이 수 분 단위로 짧게 끊긴다"는 관찰에 따라, CJ 자동화 계층은 매 요청 시작 시 세션 유효성을 스스로 확인하고 필요하면 재로그인한다 — 상위 계층(도구 계층)이 세션 상태를 알거나 관리하지 않는다.

## 3. 코드/네이밍 원칙

- **DB 컬럼은 스네이크케이스(`email_alias`, `encrypted_password`, `app_password_hash`), 서버/프론트 JS·TS 코드는 camelCase.** `pg`로 쿼리 결과를 받는 지점(리포지토리 계층)에서 한 번만 camelCase로 변환하고, 그 위 계층부터는 camelCase만 쓴다. 변환 지점을 여러 곳에 흩어두지 않는다.
- **두 비밀번호의 네이밍을 DB와 동일하게 코드에서도 그대로 따른다.**
  - CJ 계정: `encryptedPassword` / `encryptCorporatePassword()` / `decryptCorporatePassword()` — "암호화(encrypt)"라는 단어만 쓴다.
  - 앱 로그인: `appPasswordHash` / `hashAppPassword()` / `verifyAppPassword()` — "해시(hash)"라는 단어만 쓴다.
  - 변수명에 그냥 `password`, `pw`만 쓰는 것을 금지한다 — 반드시 `corporatePassword`/`appPassword`처럼 어느 쪽인지 드러나게 한다.
- **JWT 두 토큰도 이름으로 성격을 드러낸다.** `accessToken`(메모리/Zustand 보관, 짧은 만료) vs `refreshToken`(httpOnly 쿠키 보관, 폐기 가능). 둘을 함께 다루는 함수라도 매개변수/리턴 타입 이름에서 access/refresh를 생략하지 않는다.
- **CJ 사내 API의 원본 필드명(`area_code`, `room_code`, `seq` 등)은 CJ 자동화 계층 내부에서만 그대로 쓰고, 그 위 계층으로 넘어갈 때는 우리 도메인 이름(`roomId`, `cjSeq` 등 — `reservations.cj_seq` 컬럼명과 맞춤)으로 바꾼다.** 도메인 정의서 9번에 나온 대로 `area_code`가 건물/층 두 가지 의미로 혼용되는 등 원본 API 자체가 혼란스러우므로, 이 혼란이 상위 계층까지 전파되지 않게 막는 경계 역할을 CJ 자동화 계층이 담당한다.

## 4. 테스트/품질 원칙

이 프로젝트는 사내 소수 인원 대상 초기 버전이다. 커버리지 목표를 세우거나 테스트 피라미드를 풀 스택으로 갖추는 것은 이 규모에 맞지 않는다 — 아래 정도면 충분하다.

- **비즈니스 규칙(도구 계층)에 대해서만 유닛 테스트를 작성한다.** 대상: 2시간 초과 시 분할 세그먼트 계산(30분 단위, ceil(분/120), 균등 분배), 선호 회의실 우선순위 적용, 요청 처리 가능 여부 판단(범위 밖 요청 감지) 같은 순수 로직. Playwright나 DB 없이 입력→출력만 검증하면 된다.
- **CJ 자동화 계층은 공식 API가 없는 외부 시스템이므로, 매번 실제 사이트를 두드리는 자동 테스트에 의존하지 않는다.**
  - CJ 자동화 계층의 각 함수(로그인, `checkRoom`, `SaveReserve` 등)는 도구 계층에서 인터페이스로 분리해, 도구 계층 테스트에서는 이 인터페이스를 페이크/스텁으로 대체한다.
  - 실제 CJ 사이트 대상 테스트는 자동화하지 않고, 스키마 변경 등 꼭 필요할 때만 수동으로 소수 계정으로 점검한다 (도메인 정의서 9번 리스크: 여러 브라우저의 동시 로그인이 CJ 시스템에 이상 트래픽으로 감지될 가능성이 아직 검토되지 않았으므로, 자동화된 반복 실행으로 실제 시스템에 부하를 주지 않는다).
  - 응답 파싱(`reserve_all_list`의 `Y`/`N` 판정, `event_list`와의 겹침 검사 등 9번에 정리된 가용성 판단 알고리즘)은 실제 응답 샘플을 고정 fixture로 저장해두고 그 fixture에 대한 유닛 테스트로 검증한다 — 매번 실제 호출을 하지 않아도 로직 회귀를 잡을 수 있다.
- **분할 예약의 보상 트랜잭션(부분 실패 시 `delReserve`로 롤백)은 반드시 테스트한다.** 실사용자에게 가장 위험한 경로(예약이 일부만 생성된 채 남는 것)이므로, CJ 자동화 계층을 스텁으로 중간 실패를 강제로 재현하는 테스트를 둔다.
- **E2E/통합 테스트는 최소한으로.** 회원가입 → 승인 → 로그인 → 예약 1건 성공 경로 정도만 로컬(Dev 환경, 로컬 프론트/백엔드 + 클라우드 Supabase)에서 수동 또는 가벼운 스크립트로 확인한다. Vercel 배포 환경까지 흉내 내는 무거운 E2E 파이프라인은 이 규모에서 과하다.
- **CI는 처음엔 lint + 유닛 테스트 정도로 충분.** 배포 전 수동 스모크 테스트(로그인, 예약 1건)를 곁들이는 것으로 시작하고, 필요해지면 그때 확장한다.

## 5. 설정/보안/운영 원칙

- **`.env`는 Dev/Prd 모두 클라우드 Supabase를 가리킨다** (PRD 2번: "Dev/Prd가 항상 같은 Postgres를 쓰게 해서 환경 차이 문제를 줄인다"). `.env`에는 최소한 다음이 구분되어 존재해야 한다 — 절대 하나로 합치지 않는다:
  - `DATABASE_URL` (Supabase 커넥션 풀러, 6543 포트, transaction 모드/Supavisor — 5432 직접 연결은 쓰지 않는다. PRD 2번 "[리스크/결정 필요]" 항목의 결론)
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (access/refresh 서명 키 — 용도가 다르므로 같은 값을 쓰지 않는다)
  - `CORPORATE_PASSWORD_ENCRYPTION_KEY` (CJ 계정 비밀번호 암호화 키 — JWT 시크릿과 완전히 다른 키. 도메인 정의서 8번 Open Question대로, 이 키를 DB나 코드 저장소에 두지 않고 Vercel 환경변수로만 관리한다. KMS 도입 여부는 아직 미결정이지만, "암호문과 키를 같은 곳에 두지 않는다"는 원칙만은 지금부터 지킨다)
  - `OPENAI_API_KEY`, `OPENAI_MODEL` (기본값 `gpt-5-nano`, 도구 호출 정확도가 부족하면 `gpt-5-mini`로 교체 가능하도록 반드시 환경변수로 분리 — 코드에 모델명을 하드코딩하지 않는다)
- **비밀 관리 원칙: JWT 시크릿, CJ 암호화 키, OpenAI 키를 서로 다른 환경변수로 완전히 분리한다.** 하나가 유출되어도 나머지 비밀의 안전에 영향을 주지 않아야 한다.
- **Refresh Token은 폐기 가능해야 하므로 DB에 발급 이력을 남긴다.** 이 테이블(`refresh_tokens` 등)은 PRD 3번에 "아직 미착수 — 백엔드 인증 구현 시작할 때 함께 설계"로 명시되어 있다 — 지금 임의로 스키마를 먼저 만들지 않는다.
- **Access Token은 클라이언트 메모리(Zustand)에만 두고 `localStorage`에 저장하지 않는다.** Refresh Token은 httpOnly + Secure + SameSite 쿠키로만 저장한다 (PRD "인증/보안" 절 그대로).
  - **httpOnly 쿠키의 dev/prd 간 복잡성은 "쿠키를 포기"가 아니라 "같은 origin으로 배포"해서 없앤다.** 프론트/백엔드가 서로 다른 origin이면 `SameSite=None`이 강제되어 서드파티 쿠키 차단(Safari ITP 등)에 걸릴 수 있는데, 이 프로젝트는 어차피 프론트·백엔드 모두 Vercel이므로 아래처럼 처음부터 same-origin으로 맞춘다.
    - **Prd**: 프론트와 백엔드를 같은 Vercel 프로젝트/도메인으로 배포하고 백엔드는 `/api/*` 경로로 rewrite한다 → 쿠키가 same-origin이라 `SameSite=Lax`로 충분하고, 서드파티 쿠키 이슈 자체가 없다.
    - **Dev**: 로컬 프론트(Vite) 개발 서버에 `/api` 프록시를 걸어 로컬 백엔드를 같은 origin처럼 보이게 한다.
    - `Secure` 플래그는 `NODE_ENV` 기준으로 토글한다(`secure: isProd`) — dev에서는 끄고 prd에서만 켠다.
  - 이렇게 하면 PRD가 이미 정한 httpOnly 보안 결정(XSS로부터 Refresh Token 보호)을 그대로 유지하면서 dev/prd 차이는 배포 구조로 흡수된다. Refresh Token을 다시 클라이언트가 읽을 수 있는 저장소(localStorage 등)로 내리는 것은, 이 서비스가 CJ 사내 계정 암호화 자격증명까지 다루는 점을 감안해 채택하지 않는다.
- **Vercel Hobby 플랜 제약을 코드/운영에 반영한다.** 함수 실행시간 최대 300초, 메모리 2GB (PRD 2번, 2026-07 기준). CJ 자동화 함수(로그인+예약 API 호출)가 이 한도 안에서 끝나는지 특히 신경 쓰고, 트래픽이 늘어 한도에 근접하면 Pro 플랜 전환을 그때 검토한다 (지금 미리 대비 코드를 넣지 않는다).
- **콜드스타트/처리 지연에 대한 사용자 안내는 UI 원칙이자 운영 원칙이다.** CJ 자동화가 헤드리스 브라우저를 매번 새로 띄우므로 응답까지 몇 초 걸릴 수 있다 — 챗봇 UI(`docs/design/chatbot-shell.html`, 시나리오 10번)에 "확인 중입니다" 같은 처리 중 표시를 반드시 넣는다.
- **RLS는 "공개 anon 폼을 보호하는 최소 장치"이지 주 접근 통제 수단이 아니다** (`supabase/migrations/20260813000900_rls.sql` 설계 그대로). 백엔드는 service role 키로 접속하며, "본인 데이터만 접근"은 서버 코드가 항상 `user_id`로 WHERE 필터링하도록 강제하는 애플리케이션 레벨 책임이다 — RLS가 대신 막아줄 거라고 기대하고 서버 쪽 필터링을 생략하지 않는다.
- **CORS는 허용 origin을 환경변수로 명시하고, 절대 와일드카드(`*`)를 쓰지 않는다.** Refresh Token을 httpOnly 쿠키로 주고받으므로(4개 화면 전부 브라우저 fetch로 백엔드 API를 호출) `credentials: true`가 필요한데, 이 옵션은 CORS 스펙상 origin이 `*`이면 애초에 동작하지 않는다 — 반드시 구체적인 origin 목록이어야 한다.
  - Dev: 로컬 프론트(`http://localhost:5173` 등) origin만 허용.
  - Prd: 실제 Vercel 배포 도메인만 허용. 프론트/백엔드를 같은 Vercel 프로젝트(같은 origin)로 묶으면 CORS 자체가 불필요해지지만, 별도 프로젝트로 나눌 경우를 대비해 `ALLOWED_ORIGINS` 같은 환경변수로 목록을 관리하고 코드에 도메인을 하드코딩하지 않는다.
  - 회원가입 웹페이지의 `POST /registration`처럼 로그인 전 공개 엔드포인트도 origin 화이트리스트 밖의 임의 사이트에서 직접 호출되지 않도록 동일한 CORS 정책을 적용한다 (RLS가 `anon` key 남용을 막아주지 못하는 것과 같은 이유).

## 6. 프론트엔드 디렉토리 구조

React 19 + Zustand(전역 상태) + TanStack Query(서버 상태/통신), 실제 화면 4개(회원가입, 로그인, Admin 패널, 웹 챗봇 UI) 기준. 모노레포 여부는 7번 끝에서 별도로 다룬다 — 아래는 프론트엔드 패키지 하나의 내부 구조다.

```
frontend/
├─ src/
│  ├─ pages/                      # 화면 단위 (실제 4개 화면과 1:1)
│  │  ├─ register/                # 1. 회원가입 웹페이지 (공개, 비로그인)
│  │  │  ├─ RegisterPage.tsx
│  │  │  └─ PreferredRoomPicker.tsx
│  │  ├─ login/                   # 2. 로그인 페이지
│  │  │  └─ LoginPage.tsx
│  │  ├─ admin/                   # 3. Admin 승인 패널 (로그인 필요)
│  │  │  ├─ AdminPanelPage.tsx
│  │  │  └─ PendingRequestList.tsx
│  │  └─ chat/                    # 4. 웹 챗봇 UI (로그인 필요, 1차 채널)
│  │     ├─ ChatPage.tsx
│  │     ├─ MessageList.tsx
│  │     └─ MessageInput.tsx
│  ├─ components/                 # 여러 화면에서 공유하는 순수 UI 컴포넌트
│  ├─ stores/                     # Zustand — 클라이언트 전역 상태만
│  │  ├─ authStore.ts             # accessToken(메모리만!), 로그인 사용자 정보
│  │  └─ chatUiStore.ts           # 입력창 상태 등 UI 전용 상태 (서버 데이터 아님)
│  ├─ queries/                    # TanStack Query — 서버 상태/통신 전담
│  │  ├─ authQueries.ts           # 로그인/토큰 재발급
│  │  ├─ registrationQueries.ts   # 회원가입 신청, rooms 목록(anon 공개 조회)
│  │  ├─ chatQueries.ts           # 챗봇 메시지 전송/응답
│  │  └─ adminQueries.ts          # 등록 요청 목록/승인/거부
│  ├─ api/
│  │  └─ httpClient.ts            # fetch 래퍼 — accessToken 첨부, 401 시 재발급 흐름
│  ├─ routes/                     # 라우팅 정의 (4개 페이지 + 인증 가드)
│  │  └─ router.tsx
│  ├─ types/                      # 백엔드 응답 타입 (DB 스키마 파생, 1번 원칙 참고)
│  ├─ App.tsx
│  └─ main.tsx
├─ index.html
├─ package.json
└─ vite.config.ts
```

- `pages/`는 화면 4개와 정확히 대응시켜 "이 화면이 뭘 하는지" 찾기 쉽게 한다.
- 서버에서 온 데이터(예약 목록, 등록 요청 목록)는 전부 TanStack Query(`queries/`)가 캐시하고, Zustand(`stores/`)에는 정말 클라이언트 전용 상태(로그인 토큰, UI 토글)만 둔다 — 서버 데이터를 Zustand에 복제해서 두 군데서 따로 관리하지 않는다.

## 7. 백엔드 디렉토리 구조

Node.js + Express + `pg`, 2번의 레이어 원칙(LLM 오케스트레이션 → 도구 → CJ 자동화)과 실제 도메인(인증, 예약, CJ 자동화, Admin) 기준.

```
backend/
├─ src/
│  ├─ routes/                     # Express 라우트 — 얇게, 인증 미들웨어 + 컨트롤러 호출만
│  │  ├─ auth.routes.ts           # POST /auth/login, /auth/refresh, /auth/logout
│  │  ├─ registration.routes.ts   # POST /registration (공개, anon)
│  │  ├─ admin.routes.ts          # GET/POST /admin/requests/:id/approve|reject
│  │  └─ chat.routes.ts           # POST /chat/message (웹 챗봇 UI가 호출)
│  ├─ orchestration/              # [레이어 1] LLM 오케스트레이션 — 도구 계층만 의존
│  │  ├─ orchestrator.ts          # 발화 → 도구 호출 결정, 대화 루프
│  │  ├─ toolSchemas.ts           # OpenAI tool-calling 스키마 정의
│  │  └─ systemPrompt.ts
│  ├─ tools/                      # [레이어 2] 도구 계층 — 예약 비즈니스 규칙, cj-automation + db 의존
│  │  ├─ availability.tool.ts     # 가용성 조회 + 선호 회의실 우선순위 적용
│  │  ├─ reservation.tool.ts      # 예약 생성 (긴 회의 분할 + 보상 트랜잭션 포함)
│  │  ├─ modifyReservation.tool.ts
│  │  ├─ cancelReservation.tool.ts
│  │  └─ myReservations.tool.ts
│  ├─ cj-automation/              # [레이어 3] CJ 자동화 — Playwright, 최하위 계층
│  │  ├─ session.ts               # 로그인/세션 유효성 확인·재로그인
│  │  ├─ client.ts                # checkRoom/checkStraightRoom/checkDayCountLimit/SaveReserve/delReserve 등 래퍼
│  │  └─ availabilityParser.ts    # reserve_all_list + event_list 겹침 판정 (9번 알고리즘)
│  ├─ services/                   # 도메인별 서비스 (도구 계층이 호출, DB 리포지토리 사용)
│  │  ├─ authService.ts           # JWT 발급/검증/재발급/폐기
│  │  ├─ registrationService.ts   # 화이트리스트 대조, 승인/거부 (approve_account_registration_request 등 DB 함수 호출)
│  │  └─ adminService.ts
│  ├─ security/                   # 두 비밀번호를 분리해서 다루는 전용 모듈 (3번 네이밍 원칙과 1:1)
│  │  ├─ corporatePassword.ts     # encryptCorporatePassword / decryptCorporatePassword
│  │  └─ appPassword.ts           # hashAppPassword / verifyAppPassword
│  ├─ db/
│  │  ├─ pool.ts                  # pg Pool, 커넥션 풀러(6543) 연결
│  │  └─ repositories/
│  │     ├─ userRepository.ts
│  │     ├─ roomRepository.ts
│  │     ├─ reservationRepository.ts
│  │     └─ registrationRequestRepository.ts
│  ├─ middleware/
│  │  ├─ requireAuth.ts           # accessToken 검증 (챗봇/Admin 공통)
│  │  └─ requireAdmin.ts
│  ├─ config/
│  │  └─ env.ts                   # .env 파싱 (5번 — 시크릿별로 이름 분리해서 로드)
│  └─ app.ts                      # Express 앱 조립
├─ api/                           # Vercel Serverless Functions 진입점 (app.ts를 감싸는 얇은 핸들러)
├─ package.json
└─ tsconfig.json
```

- 폴더 이름 자체가 2번의 의존 방향(`orchestration` → `tools` → `cj-automation`)을 그대로 드러내도록 지었다 — import 방향이 이 순서를 거스르면(예: `cj-automation`이 `orchestration`을 import) 구조 원칙 위반으로 간주한다.
- `security/`는 두 비밀번호를 절대 섞지 않는다는 1번/3번 원칙을 강제하기 위한 전용 모듈이다 — 다른 어떤 파일도 암호화/해시 로직을 직접 구현하지 않고 이 모듈만 사용한다.

### 모노레포 vs 분리 레포 — TBD

프론트엔드/백엔드를 하나의 레포로 둘지, 완전히 분리할지는 **지금까지 어느 문서에서도 명시적으로 결정된 바 없다.** 실용적인 기본값을 추천하되, 확정된 사항은 아니다:

- **권장(TBD): 모노레포 1개, 최상위에 `frontend/`, `backend/` 두 폴더.** 두 레포로 나눌 만큼 배포 주기나 팀이 분리되어 있지 않고(사내 소수 인원 대상 초기 버전), 프론트와 백엔드가 같은 DB 스키마를 공유하는 타입을 주고받을 일이 많아 한 레포가 관리 부담이 적다. 다만 각자 별도 `package.json`으로 독립 배포(Vercel 프로젝트 2개 또는 1개+라우팅)는 유지한다.
- 이 구조는 실제 구현을 시작할 때 다시 확인하고 확정해야 한다 — 이 문서의 6번/7번 트리는 모노레포를 가정한 상대 경로(`frontend/`, `backend/`)로 적었지만, 분리 레포로 결정되어도 내부 구조 자체는 그대로 적용 가능하다.
