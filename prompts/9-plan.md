# 실행계획 — 회의실 예약 Agent

`docs/`, `prompts/`, `supabase/`에 정리된 확정 사항(도메인 정의서, PRD, ERD, 프로젝트 구조 원칙, 통합 스키마, 보안 검토 결과)을 근거로 DB/백엔드/프론트엔드 단위 Task로 분해한 실행계획이다. 각 Task는 작업 내용·선행 Task·체크박스형 완료 조건으로 구성된다.

**전체 진행 순서 요약**: `DB-1`(보안 결함 수정)이 다른 모든 인증 관련 작업의 전제 조건이므로 최우선. 그다음 `DB-2`(실제 Supabase 프로젝트 생성)가 백엔드/프론트 개발 착수의 공통 전제. 이후 DB→백엔드→프론트 순으로 대체로 진행되지만, 화면(프론트) 스캐폴딩과 디자인 토큰 반영(`FE-1`)은 백엔드와 병행 가능하다.

---

## 데이터베이스 (DB)

### DB-1. 보안 결함 긴급 수정 — SECURITY DEFINER 함수 권한 회수 + 화이트리스트 재검증

- **작업 내용**: `security-reviewer` 검토에서 발견된 치명적 결함(anon key로 `approve_account_registration_request` 등을 직접 호출해 Admin 권한을 탈취할 수 있는 문제)을 고치는 새 마이그레이션 파일을 `supabase/migrations/`에 추가한다.
  - `approve_account_registration_request`, `reject_account_registration_request`, `get_user_frequent_rooms` 세 함수에 `revoke execute on function ... from public, anon, authenticated;` 추가
  - `approve_account_registration_request`가 호출자가 넘긴 `p_is_auto`를 그대로 신뢰하지 않고, 함수 내부에서 `admin_whitelist`를 직접 재조회해 `is_admin` 여부를 결정하도록 로직 수정
  - `supabase/8-schema.sql`(통합본)에도 동일하게 반영
- **선행 Task**: 없음 (다른 모든 인증 관련 Task의 선행 조건)
- **완료 조건**:
  - [x] 새 마이그레이션 파일이 `supabase/migrations/`에 타임스탬프 순으로 추가됨 (`20260813001200_fix_admin_escalation.sql`)
  - [x] 세 함수 모두 `REVOKE EXECUTE ... FROM public, anon, authenticated` 적용 확인
  - [x] `approve_account_registration_request`가 `admin_whitelist`를 직접 재조회하도록 수정되고, 호출자 입력값(`p_is_auto`)만으로 Admin이 부여되지 않음을 코드로 확인 (`p_is_auto` 파라미터 자체를 제거, 수동 승인 시 `p_admin_user_id`가 실제 활성 Admin인지도 DB가 검증)
  - [x] `supabase/8-schema.sql`이 이 수정 사항까지 반영해 최신화됨
  - [ ] 로컬/스테이징 Supabase 프로젝트에 적용 후, anon key로 세 함수를 직접 RPC 호출 시 권한 오류로 거부되는지 실제 테스트로 확인 (아직 실제 프로젝트 없음 — DB-2 완료 후 진행)

### DB-2. 실제 Supabase 프로젝트 생성 및 마이그레이션 적용

- **작업 내용**: supabase.com에 프로젝트 생성(Dev/Prd 공용, PRD 결정사항), `supabase/migrations/` 전체를 순서대로 적용, `.env`의 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`/`DATABASE_URL`(커넥션 풀러 6543 포트) 채움.
- **선행 Task**: DB-1
- **완료 조건**:
  - [ ] Supabase 프로젝트 생성 완료
  - [ ] `supabase/migrations/` 전체(DB-1 포함)가 순서대로 적용되어 오류 없이 끝까지 실행됨
  - [ ] `.env`의 Supabase/DB 관련 값이 실제 프로젝트 값으로 채워짐 (커넥션 풀러 주소 사용, 5432 직접 연결 아님)
  - [ ] `psql` 또는 Supabase 대시보드에서 8개 테이블이 모두 생성된 것을 확인

### DB-3. Refresh Token 폐기 테이블 추가

- **작업 내용**: PRD "인증/보안" 절에서 결정된 대로, Refresh Token 발급 이력을 저장해 서버가 개별/전체 폐기(revoke)할 수 있는 테이블(`refresh_tokens` 등)을 설계·추가하는 마이그레이션 작성. `security-reviewer` 권고대로 `users.password_changed_at`(또는 동등한 컬럼) 추가도 함께 검토.
- **선행 Task**: DB-2
- **완료 조건**:
  - [ ] `refresh_tokens` 테이블(또는 동등 설계)이 마이그레이션으로 추가됨 — 최소 컬럼: 토큰 식별자/해시, `user_id` FK, 발급/만료 시각, 폐기 여부·시각
  - [ ] 개별 토큰 폐기(로그아웃)와 사용자 전체 토큰 폐기(비밀번호 변경/보안사고 대응) 두 시나리오 모두 쿼리로 처리 가능한 구조인지 확인
  - [ ] `supabase/8-schema.sql`에도 반영

### DB-4. 동의 철회 시 자격증명 즉시 폐기 RPC 추가

- **작업 내용**: 도메인 정의서 8번 "동의 철회 시 즉시 삭제 및 접근 차단" 요구사항을 DB 레벨에서 강제하는 RPC(`revoke_user` 등) 추가. `users.status='revoked'` 전환과 동시에 `encrypted_password`/`app_password_hash`를 원자적으로 비운다.
- **선행 Task**: DB-2
- **완료 조건**:
  - [ ] `revoke_user(user_id)` 형태의 함수가 마이그레이션으로 추가됨
  - [ ] 함수 실행 시 `status='revoked'`, `revoked_at=now()`, `encrypted_password=''`, `app_password_hash=null`이 하나의 트랜잭션으로 처리됨
  - [ ] `check (status <> 'revoked' or revoked_at is not null)` 등 정합성 제약 추가
  - [ ] `supabase/8-schema.sql`에도 반영

### DB-5. 회의실 마스터데이터 시딩

- **작업 내용**: `rooms` 테이블에 상암S시티 3F·12F~16F 실제 회의실 데이터(room_code, area_code, sub_area_code, room_name, floor_label)를 입력. `capacity`는 CJ API의 `room_info.ATTENDER_LIMIT` 파싱 결과로 채우는 것이 원칙이나(도메인 정의서 9번), 최초 시딩은 수동 스크립트로 진행 가능.
- **선행 Task**: DB-2, (capacity 자동 채움은 BE-4·BE-5 완료 후 재실행 권장)
- **완료 조건**:
  - [ ] 3F(3F-1~3F-12), 12F~16F 각 층의 실제 회의실이 `rooms`에 모두 입력됨
  - [ ] B1F/2F는 데이터에 아예 포함하지 않거나 `is_bookable=false`로 명시적으로 제외됨
  - [ ] 각 회의실의 `room_code`/`area_code`/`sub_area_code`가 실제 CJ 시스템 값과 일치함을 실사용 조회로 검증
  - [ ] `capacity`가 최소 1회 이상 실제 값(추정치 아님)으로 채워짐

---

## 백엔드 (Backend)

### BE-1. 백엔드 프로젝트 스캐폴딩

- **작업 내용**: `5-project-principle.md` 7번 구조대로 Node.js + Express + TypeScript 프로젝트 초기화. `orchestration/ tools/ cj-automation/ services/ security/ db/ middleware/ config/` 폴더 생성, `pg` 커넥션 풀(풀러 6543 사용) 연결, `.env` 파싱 모듈(`config/env.ts`) 작성, Vercel Functions 진입점(`api/`) 구성.
- **선행 Task**: DB-2
- **완료 조건**:
  - [ ] `5-project-principle.md` 7번의 폴더 구조가 그대로 생성됨
  - [ ] `pg` Pool이 커넥션 풀러(6543)로 연결되고, 로컬에서 간단한 쿼리(`select now()`)가 성공함
  - [ ] `.env`의 시크릿(JWT 두 키, `CORPORATE_PASSWORD_ENCRYPTION_KEY`, `OPENAI_API_KEY`)이 서로 다른 변수로 분리 로딩됨을 확인
  - [ ] Vercel Functions로 배포했을 때 헬스체크 엔드포인트(`GET /api/health`)가 정상 응답

### BE-2. 인증 모듈 (회원가입 / 로그인 / JWT)

- **작업 내용**: `security/corporatePassword.ts`(암호화/복호화), `security/appPassword.ts`(해시/검증), `authService.ts`(JWT 발급·재발급·폐기), `routes/auth.routes.ts`, `routes/registration.routes.ts` 구현. Access Token은 짧은 만료로 응답 바디에, Refresh Token은 httpOnly+Secure+SameSite 쿠키로 발급.
- **선행 Task**: BE-1, DB-3
- **완료 조건**:
  - [ ] 회원가입 API가 사내 계정 비밀번호는 암호화, 앱 로그인 비밀번호는 해시로 각각 다른 모듈을 통해 저장함 (두 로직이 물리적으로 다른 파일에 있음)
  - [ ] 화이트리스트 매칭 시 자동승인, 아니면 pending으로 접수되는 흐름이 DB-1의 안전한 함수 호출 경로로 동작함
  - [ ] 로그인 성공 시 Access Token(응답 바디) + Refresh Token(httpOnly 쿠키) 둘 다 발급됨
  - [ ] Access Token 만료 후 재발급 엔드포인트가 Refresh Token으로 정상 동작함
  - [ ] 로그아웃 시 DB-3의 폐기 테이블에 해당 Refresh Token이 무효 처리됨
  - [ ] 승인 대기/거부/자격증명 오류 각각의 로그인 실패 상태 메시지가 올바르게 구분되어 반환됨

### BE-3. Admin 승인 API

- **작업 내용**: `routes/admin.routes.ts`, `adminService.ts` — 대기중 등록 요청 목록 조회, 승인/거부 처리(DB-1의 안전한 RPC 호출), Admin 권한 검증 미들웨어(`requireAdmin`).
- **선행 Task**: BE-2, DB-1
- **완료 조건**:
  - [ ] `GET /admin/requests`가 pending 목록을 반환 (비밀번호/암호문은 응답에 절대 포함 안 됨)
  - [ ] 승인/거부 API가 DB-1에서 수정된 RPC를 정상 호출하고, 결과가 `account_registration_requests`/`users`에 반영됨
  - [ ] `is_admin=false`인 사용자의 토큰으로 호출 시 403 반환
  - [ ] 승인/거부 후 목록에서 해당 항목이 사라지고 처리 이력에 반영됨

### BE-4. CJ 자동화 계층

- **작업 내용**: `cj-automation/session.ts`(Playwright 로그인, 세션 유효성 확인+재로그인), `cj-automation/client.ts`(9번 API 명세의 각 엔드포인트 래퍼), `cj-automation/availabilityParser.ts`(`reserve_all_list` + `event_list` 겹침 판정 알고리즘). Vercel Functions 위에서 `@sparticuz/chromium` 사용.
- **선행 Task**: BE-1
- **완료 조건**:
  - [ ] 사내 계정 암호화 자격증명을 복호화해 Playwright로 실제 로그인에 성공함 (이 계층 밖으로 복호화된 비밀번호가 전달되지 않음)
  - [ ] `getDayPilotConfReserveList`, `checkRoom`, `checkStraightRoom`, `checkDayCountLimit`, `SaveReserve`, `delReserve`, `getConfReservationInfo`, `bindMyReservation` 전부 래핑됨
  - [ ] 가용성 판단 알고리즘(그리드 AND event_list)이 도메인 정의서 9번에 정리된 실사용 케이스(8/13 스캔 결과)와 동일한 결과를 냄 — fixture 기반 유닛 테스트로 검증
  - [ ] Vercel Functions 환경(콜드스타트, 300초 제한 이내)에서 로그인+API 호출 1건이 실제로 성공함

### BE-5. 회의실 마스터데이터 동기화

- **작업 내용**: `getDayPilotConfReserveList` 응답의 `room_info`(`ATTENDER_LIMIT` 등)를 파싱해 `rooms.capacity`를 채우거나 갱신하는 동기화 로직/스크립트 작성.
- **선행 Task**: BE-4, DB-5
- **완료 조건**:
  - [ ] 전체 층(3F, 12F~16F) 스캔 후 `rooms.capacity`가 실제 값으로 갱신됨
  - [ ] 재실행해도 기존 값과 다를 때만 갱신되는 멱등적 동작 확인 (upsert)

### BE-6. 예약 도구(tools) 계층

- **작업 내용**: `tools/availability.tool.ts`(가용성 조회+선호회의실 우선순위+조건검색+이력기반추천), `tools/reservation.tool.ts`(예약 생성, 긴 회의 분할+보상 트랜잭션 포함), `tools/modifyReservation.tool.ts`, `tools/cancelReservation.tool.ts`, `tools/myReservations.tool.ts`. `checkRoom → checkStraightRoom → checkDayCountLimit → SaveReserve` 순서 강제.
- **선행 Task**: BE-4, DB-2
- **완료 조건**:
  - [ ] 도메인 정의서 2번의 9개 유스케이스(해피패스/조건검색/이력추천/긴회의분할/내예약조회/변경/취소/온보딩 제외)가 각각 함수로 구현됨
  - [ ] 2시간 초과 요청 시 세그먼트 분할(30분 단위, ceil(분/120), 균등분배) 유닛 테스트 통과
  - [ ] 분할 예약 중 일부 실패 시 이미 생성된 예약이 `delReserve`로 자동 취소되는 보상 트랜잭션 테스트 통과
  - [ ] 예약 변경/취소는 대상이 모호할 때(여러 건) 바로 진행하지 않고 명확한 오류/안내를 반환함 (LLM 계층이 되물을 수 있도록)
  - [ ] `reservations_no_overlap` EXCLUDE 제약 위반 시 서버가 이를 "이미 예약됨" 사용자 메시지로 정상 변환함

### BE-7. LLM 오케스트레이션 계층

- **작업 내용**: `orchestration/systemPrompt.ts`(비즈니스 규칙 + "요청 처리 가능 여부 판단" 원칙 반영), `orchestration/toolSchemas.ts`(OpenAI tool-calling 스키마), `orchestration/orchestrator.ts`(대화 루프, 세션 상태 관리). 모델은 `OPENAI_MODEL` 환경변수(`gpt-5-nano` 기본).
- **선행 Task**: BE-6
- **완료 조건**:
  - [ ] 시스템 프롬프트에 운영시간/2시간 제한/7일 범위/상암S시티 고정/반복예약 미지원 등이 명시됨
  - [ ] "요청 처리 가능 여부 판단" 원칙이 프롬프트 최상위에 반영되어, 범위 밖 요청에 임의 실행을 시도하지 않고 안내/되묻기로 응답함을 시나리오 테스트로 확인
  - [ ] LLM이 BE-6의 도구만 호출하고 CJ 시스템/DB에 직접 접근하지 않음 (코드 레벨로 원천 차단되어 있음)
  - [ ] 예약 확정(SaveReserve) 직전 사용자 명시적 확인 없이는 실행되지 않음
  - [ ] 세션 상태(진행 중인 예약 등)가 대화록 텍스트가 아니라 서버 상태로 관리됨

### BE-8. 챗봇 API 엔드포인트

- **작업 내용**: `routes/chat.routes.ts` — `POST /chat/message`, 로그인 세션(Access Token) 검증, BE-7 오케스트레이터 호출, 응답 반환.
- **선행 Task**: BE-7, BE-2
- **완료 조건**:
  - [ ] 미로그인 요청은 401로 거부됨
  - [ ] 로그인된 사용자의 메시지가 오케스트레이터를 거쳐 도구 호출 결과까지 포함한 응답으로 반환됨
  - [ ] 콜드스타트로 응답이 지연될 수 있는 구간에 대해 클라이언트가 처리 중 상태를 표시할 수 있는 응답 구조(스트리밍 또는 상태 필드) 제공

### BE-9. CORS 및 배포 보안 설정

- **작업 내용**: `5-project-principle.md` 5번의 CORS 원칙(허용 origin 환경변수화, 와일드카드 금지, same-origin 배포 우선) 적용. Vercel `vercel.json`에 프론트/백엔드 same-origin 라우팅(`/api/*` rewrite) 구성.
- **선행 Task**: BE-1
- **완료 조건**:
  - [ ] `ALLOWED_ORIGINS` 환경변수로 CORS 허용 목록이 관리되고 코드에 도메인이 하드코딩되지 않음
  - [ ] Dev 환경에서 프론트(Vite) → 백엔드 프록시로 같은 origin처럼 동작함
  - [ ] Prd 배포에서 프론트/백엔드가 같은 Vercel 도메인으로 묶여 있음 (또는 분리 배포 시 CORS 화이트리스트가 정확히 설정됨)
  - [ ] `Secure` 쿠키 플래그가 `NODE_ENV` 기준으로 정확히 토글됨

---

## 프론트엔드 (Frontend)

### FE-1. 프론트엔드 프로젝트 스캐폴딩 + 디자인 토큰 반영

- **작업 내용**: `5-project-principle.md` 6번 구조대로 React 19 + Zustand + TanStack Query 프로젝트 초기화. `DESIGN.md`(Intercom 기반) 토큰을 CSS 변수/테마 시스템으로 정리하고, 공용 `components/`(버튼, 인풋, 카드, 칩 등)를 `docs/design/chatbot-shell.html`에서 구현된 스타일 그대로 컴포넌트화.
- **선행 Task**: 없음 (백엔드와 병행 가능)
- **완료 조건**:
  - [ ] `5-project-principle.md` 6번의 폴더 구조(`pages/ components/ stores/ queries/ api/ routes/ types/`)가 그대로 생성됨
  - [ ] `DESIGN.md`의 색상/타이포/radius/spacing 토큰이 CSS 변수로 정의되고 라이트/다크 테마 모두 지원됨
  - [ ] 버튼(primary/ghost), 입력창, 카드, 칩, 뱃지 공용 컴포넌트가 `docs/design/chatbot-shell.html`과 시각적으로 동일하게 구현됨
  - [ ] `httpClient.ts`가 Access Token 첨부 + 401 시 재발급 흐름을 처리함

### FE-2. 회원가입 페이지

- **작업 내용**: `7-wireframes.md` 1번 와이어프레임 기준. 사내 계정 ID/PW, 선호 회의실 우선순위(추가/삭제), 앱 로그인 비밀번호+확인 폼. 데스크톱/모바일(≤860px) 레이아웃 모두 구현.
- **선행 Task**: FE-1, BE-2(회원가입 API)
- **완료 조건**:
  - [ ] 와이어프레임의 모든 입력 필드가 구현되고, 두 비밀번호(사내계정/앱로그인) 입력란이 명확히 구분 표기됨
  - [ ] 선호 회의실 추가/삭제가 동작하고 `rooms` 목록을 anon 공개 조회로 가져옴
  - [ ] 제출 후 접수 확인 화면(자동승인/관리자승인 분기 안내)이 표시됨
  - [ ] 860px 이하에서 와이어프레임의 모바일 레이아웃(1컬럼)으로 전환됨
  - [ ] 제출 실패(중복 ID 등) 시 에러 메시지가 명확히 표시됨

### FE-3. 로그인 페이지

- **작업 내용**: `7-wireframes.md` 2번 기준. 사내 계정 ID + 앱 로그인 비밀번호 입력, 로그인 성공 시 세션 저장 후 챗봇 UI(또는 Admin 권한이면 Admin 패널)로 리다이렉트.
- **선행 Task**: FE-1, BE-2
- **완료 조건**:
  - [ ] 로그인 성공 시 Access Token이 Zustand 스토어(메모리)에만 저장되고 `localStorage`에 저장되지 않음
  - [ ] 승인 대기/거부/자격증명 오류 상태 메시지가 각각 구분되어 표시됨
  - [ ] Admin 권한 사용자는 Admin 패널로, 일반 사용자는 챗봇 UI로 정확히 라우팅됨

### FE-4. Admin 승인 패널

- **작업 내용**: `7-wireframes.md` 3번 기준. 대기중 등록 요청 목록(카드), 승인/거부 버튼, 처리 완료 이력. 모바일에서는 이력 기본 접힘.
- **선행 Task**: FE-1, BE-3
- **완료 조건**:
  - [ ] 대기중 목록이 실시간(또는 재조회)으로 표시되고 승인/거부 처리 후 목록에서 사라짐
  - [ ] 비밀번호/암호문이 어떤 형태로도 화면에 노출되지 않음
  - [ ] Admin 권한이 없는 사용자가 접근 시 이 화면으로 진입할 수 없음 (라우팅 가드)
  - [ ] 860px 이하에서 처리 완료 이력이 기본 접힘 상태로 렌더링됨

### FE-5. 웹 챗봇 UI

- **작업 내용**: `7-wireframes.md` 4번 / `docs/design/chatbot-shell.html` 기준. 메시지 스레드, 단일/다중 회의실 제안 카드, 빠른명령 칩, 입력창, 오른쪽 사이드바(오늘예약/선호회의실/규칙안내). BE-8 API와 실제 연동.
- **선행 Task**: FE-1, BE-8
- **완료 조건**:
  - [ ] 사용자 메시지 전송 → 백엔드 응답 → 메시지 스레드에 렌더링되는 전체 흐름이 실제로 동작함
  - [ ] 회의실 제안 카드의 [확정]/[다른 곳 보기] 버튼이 실제 예약 확정/재조회 API를 호출함
  - [ ] 콜드스타트로 응답이 지연되는 구간에 "확인 중입니다" 처리중 표시가 나타남 (서비스 시나리오 10번)
  - [ ] 빠른명령 칩(내 예약 조회/자주 쓰는 회의실/예약 취소)이 각각 대응하는 요청을 전송함
  - [ ] 860px 이하에서 사이드바가 숨겨지고 채팅 컬럼이 전체폭으로 전환됨

### FE-6. 반응형 전체 QA 및 접근성 점검

- **작업 내용**: 4개 화면 전체를 실제 모바일/태블릿 뷰포트에서 점검하고, `7-wireframes.md`에 TBD로 남겨둔 "모바일에서 챗봇 사이드바 정보를 다시 보는 방법"을 확정해 구현.
- **선행 Task**: FE-2, FE-3, FE-4, FE-5
- **완료 조건**:
  - [ ] 4개 화면이 실제 모바일 기기(또는 브라우저 반응형 모드) 860px/480px 구간에서 모두 정상 동작
  - [ ] 모바일에서 숨겨진 챗봇 사이드바 정보(오늘예약/선호회의실/규칙)에 접근할 수 있는 대체 UI가 구현됨
  - [ ] 키보드 포커스 상태(`:focus-visible`)가 모든 인터랙션 요소에서 시각적으로 확인됨
  - [ ] 로그인~예약 1건 확정까지의 골든 패스를 모바일 뷰포트에서 수동으로 완주 확인
