-- =============================================================================
-- CJ프레시웨이 회의실 예약 웹 챗봇 Agent — 최종 통합 스키마
-- =============================================================================
--
-- 이 파일은 supabase/migrations/ 아래 13개 마이그레이션 파일(2026-08-13~14 이틀 동안
-- 이력형으로 누적된 CREATE/ALTER)을 시간순으로 전부 적용한 "최종 결과 상태"를
-- 처음부터 다시 깔끔하게 작성한 참고용 통합본이다.
--
-- 주의:
--   - 이 파일은 마이그레이션 도구로 실행되는 실제 마이그레이션 파일이 아니다.
--     실제 마이그레이션 이력은 여전히 supabase/migrations/ 의 13개 파일이 정본이며,
--     이 파일은 그 이력을 건드리지 않는 별도의 "현재 스키마 스냅샷" 참고 문서다.
--   - 예: users.app_password_hash는 20260813001100 마이그레이션에서 나중에 추가됐지만,
--     여기서는 처음부터 완성형 CREATE TABLE에 포함시켜 작성한다.
--     approve_account_registration_request 함수도 재정의 이력 없이 최종 버전 하나만 담는다.
--
-- 참고 문서: docs/1-domain-definition-meeting-room-agent.md (도메인 정의),
--           docs/4-prd.md (PRD), docs/8-erd.md (ERD)
--
-- [참고: Vercel 서버리스 연결] 백엔드는 pg로 Postgres에 직접 연결한다. 요청마다
-- 커넥션을 새로 여는 서버리스 환경 특성상 5432 직접 연결 대신 Supabase 커넥션
-- 풀러(6543, transaction 모드/Supavisor) 사용을 기본값으로 한다 (docs/4-prd.md 참고).
-- 백엔드는 service role 권한으로 연결하므로 아래 RLS 정책과 무관하게 항상 전체 접근 가능하다.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. 확장 기능 (Extensions)
-- -----------------------------------------------------------------------------

-- pgcrypto: gen_random_uuid()로 UUID PK를 생성하기 위해 사용.
--   비밀번호 자체의 암호화/복호화는 DB가 아니라 애플리케이션 레벨(AES 등)에서 수행한다.
--   (Supabase/Postgres 자체 암호화 기능에는 의존하지 않는다는 원칙)
create extension if not exists pgcrypto;

-- btree_gist: reservations 테이블에서 "같은 회의실 + 겹치는 시간대" 중복 예약을
--   DB 레벨에서 원천 차단하는 EXCLUDE 제약조건에 필요.
--   (uuid 컬럼을 gist 인덱스에서 등치(=) 비교하려면 btree_gist가 있어야 함)
create extension if not exists btree_gist;


-- -----------------------------------------------------------------------------
-- 0-1. 공통 유틸리티 함수
-- -----------------------------------------------------------------------------

-- updated_at 컬럼 자동 갱신 트리거 함수 (여러 테이블이 공유하는 단순 유틸리티, 비즈니스 로직 아님)
-- search_path를 고정한다(20260818230000 마이그레이션 — Supabase Advisor가 실제 프로젝트에서
-- function_search_path_mutable로 잡아냄. 로컬 Postgres엔 그 어드바이저가 없어 여태 안 드러났다).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 1. AdminWhitelist (Admin 화이트리스트)
-- -----------------------------------------------------------------------------
-- 가입 즉시 자동으로 Admin 권한을 받는 사내 계정 ID 사전 등록 목록.
-- Admin 부트스트랩 문제(최초 Admin을 누가 승인하나) 해결용 정적 목록.

create table if not exists public.admin_whitelist (
  id uuid primary key default gen_random_uuid(),
  email_alias text not null unique,       -- 화이트리스트에 올라간 사내 계정 ID
  reason text,                            -- 등록 사유
  added_by_user_id uuid,                  -- 등록한 Admin (부트스트랩 최초 등록 시에는 NULL 허용 = 수동 시딩)
  created_at timestamptz not null default now()
);

comment on table public.admin_whitelist is
  'Admin 부트스트랩용 사전 등록 목록. 여기 있는 email_alias로 가입 신청하면 자동 승인 + Admin 권한 부여됨. Admin만 추가/제거 가능.';

-- 최초 Admin 시드: jiil (닭과 달걀 문제 해결용 정적 데이터, 재실행 안전)
insert into public.admin_whitelist (email_alias, reason)
values ('jiil', '최초 Admin 부트스트랩 계정')
on conflict (email_alias) do nothing;


-- -----------------------------------------------------------------------------
-- 2. User (요청자)
-- -----------------------------------------------------------------------------
-- 온보딩(회원가입 신청 -> Admin 승인 또는 화이트리스트 자동승인)을 마친 사용자만
-- 이 테이블에 row로 존재한다 (도메인 문서 5번: "한 User는 정확히 하나의 승인된
-- AccountRegistrationRequest로부터 생성된다"). 그래서 이 테이블에는 pending/rejected
-- 상태가 없다 -- 그 상태는 account_registration_requests 테이블이 담당한다.
-- users.status는 "승인 이후" 생명주기(이용 가능 <-> 동의 철회)만 표현한다.
--
-- [두 종류의 비밀번호를 절대 혼동하지 말 것]
--   - encrypted_password: 사내 계정 비밀번호. CJ 자동화 로그인에 필요해 애플리케이션 레벨
--     암호화(AES 등)로 저장하며 복호화 가능해야 한다. 복호화 키는 이 DB와 분리된
--     환경변수/KMS에 보관한다 (키와 암호문을 같은 DB에 두면 DB 유출 시 사실상 평문 유출).
--   - app_password_hash: 이 서비스 자체 로그인(JWT 발급)용 비밀번호 해시. 로그인 검증에만
--     쓰이므로 bcrypt/argon2 같은 단방향 해시로 저장한다 -- 절대 복호화 가능한 암호화로 만들지 않는다.
-- 평문 비밀번호는 어떤 컬럼/로그/화면/메일에도 남기지 않는다.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),

  -- 텔레그램 사용자ID: 딥링크(t.me/봇?start=토큰)로 확보한 위조 불가능한 값만 신뢰한다.
  -- 1차 채널은 웹(회원가입/로그인)이므로 현재는 NULL. 텔레그램 채널 추가 시 사용할 향후 확장용 컬럼.
  telegram_user_id bigint unique,

  -- 사내 계정 식별자 (email_alias, 예: 사번/아이디)
  email_alias text not null unique,

  -- 사내 계정 비밀번호: 애플리케이션 레벨 AES 등으로 암호화된 결과(ciphertext)만 저장한다.
  encrypted_password text not null,

  -- 앱 자체 로그인 비밀번호 해시 (bcrypt/argon2 등 단방향). 로그인 대상 테이블이므로 NOT NULL로 강제.
  app_password_hash text not null,

  is_admin boolean not null default false,

  -- 승인 이후 생명주기: active(이용 가능) / revoked(동의 철회, 자격증명 폐기 요청) /
  -- locked(로그인 5회 연속 실패로 잠김, Admin 해제 전까지 로그인 불가 — 20260820 마이그레이션)
  status text not null default 'active' check (status in ('active', 'revoked', 'locked')),

  -- 연속 로그인 실패 횟수. MAX_LOGIN_ATTEMPTS(5) 도달 시 status가 locked로 바뀐다.
  -- 로그인 성공 또는 Admin의 잠금 해제 시 0으로 리셋된다. (20260820 마이그레이션)
  failed_login_attempts smallint not null default 0,

  approved_at timestamptz not null default now(),  -- 등록 승인 일시
  revoked_at timestamptz,                          -- 동의 철회 일시 (해당 시에만 값 존재)

  -- [20260817 추가] 매주 반복 예약 기능용 무인(unattended) 로그인 동의 기록. 반복 예약은
  -- 대상일이 CJ 예약 가능 범위(7일 전)에 들어오는 순간 사용자가 앱에 없어도 서버가 그
  -- 사용자의 CJ 계정으로 대신 로그인해 예약을 생성해야 하므로, 평소 요청 기반 로그인과
  -- 달리 별도의 명시적 동의가 필요하다. 유효한 동의 = consent_at is not null and
  -- consent_revoked_at is null. 상세 근거는 supabase/migrations/20260817000000_recurring_reservations.sql 참고.
  unattended_booking_consent_at timestamptz,
  unattended_booking_consent_revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  '온보딩 승인을 마친 사용자. 텔레그램 사용자ID는 딥링크로 확보한 값만 신뢰(자기신고 금지), 현재는 nullable(향후 채널 확장용).';
comment on column public.users.encrypted_password is
  '애플리케이션 레벨 AES로 암호화된 사내 계정 비밀번호(복호화 가능, CJ 자동화 로그인용). DB 자체 암호화 기능에 의존하지 않음. 평문 저장/로깅 금지.';
comment on column public.users.app_password_hash is
  '이 서비스 자체 로그인용 비밀번호 해시(bcrypt/argon2 등 단방향, 복호화 불가/불필요). 사내 계정 비밀번호(encrypted_password)와 절대 혼동 금지.';
comment on column public.users.unattended_booking_consent_at is
  '매주 반복 예약을 위해 서버가 사용자 CJ 계정으로 무인 로그인하는 것에 동의한 시각. 반복 예약 규칙을 만들려면 이 동의가 유효해야 한다(철회 안 됨).';
comment on column public.users.unattended_booking_consent_revoked_at is
  '무인 로그인 동의를 철회한 시각. NULL이면 아직 철회 안 함. 철회되면 그 시점부터 이 사용자의 반복 예약 실행을 중단해야 한다(서버 로직에서 강제).';

-- admin_whitelist.added_by_user_id -> users.id FK
alter table public.admin_whitelist
  add constraint admin_whitelist_added_by_user_id_fkey
  foreign key (added_by_user_id) references public.users(id) on delete set null;

create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. AccountRegistrationRequest (계정 등록 요청)
-- -----------------------------------------------------------------------------
-- 회원가입 웹페이지에서 제출한 사내 계정 등록 신청 건. 화이트리스트 미해당 시
-- Admin의 승인 대상. 승인되면 users row가 생성된다.

create table if not exists public.account_registration_requests (
  id uuid primary key default gen_random_uuid(),

  email_alias text not null,                   -- 신청한 사내 계정 ID
  encrypted_password text not null,             -- 애플리케이션 레벨 AES로 암호화된 사내 계정 비밀번호

  -- 회원가입 시 함께 입력한 앱 자체 로그인 비밀번호 해시. 승인 시 users.app_password_hash로 복사된다.
  -- 신청 단계에서는 서버 코드가 항상 채우지만, 텔레그램 전용 컬럼처럼 과거 흐름과의 호환을 위해
  -- DB 레벨에서는 nullable로 두고 users 테이블에서만 NOT NULL로 엄격하게 강제한다.
  app_password_hash text,

  -- 텔레그램 딥링크(t.me/봇?start=토큰) 연동용 1회성 토큰 (향후 텔레그램 채널 확장용, 현재 미사용).
  telegram_deeplink_token text unique,
  telegram_user_id bigint,                      -- 딥링크 클릭 전 또는 텔레그램 미연동 시 NULL

  status text not null default 'pending'
    check (status in ('pending', 'auto_approved', 'approved', 'rejected')),

  -- 처리한 Admin. 화이트리스트 자동승인인 경우 NULL + processed_by_system = true 로 표시한다
  -- ("system"이 처리했다는 의미를 문자열로 흉내내지 않고 명시적 플래그로 표현).
  processed_by_user_id uuid references public.users(id) on delete set null,
  processed_by_system boolean not null default false,
  processed_at timestamptz,

  -- 승인 완료 시 생성된 User row와 연결 (감사 추적용)
  resulting_user_id uuid references public.users(id) on delete set null,

  -- 회원가입 신청 시 선택한 선호 회의실 ID 배열(순서 = 우선순위, 인덱스 0이 1순위).
  -- 승인 시 애플리케이션 코드가 이 값을 읽어 user_preferred_rooms로 옮긴다.
  preferred_room_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),

  constraint account_registration_requests_processed_consistency check (
    (status in ('pending'))
    or (status in ('auto_approved', 'approved', 'rejected') and processed_at is not null)
  )
);

create index if not exists account_registration_requests_email_alias_idx
  on public.account_registration_requests (email_alias);

create index if not exists account_registration_requests_status_idx
  on public.account_registration_requests (status);

comment on table public.account_registration_requests is
  '회원가입 웹페이지 신청 건. 화이트리스트 매칭 시 auto_approved, 아니면 pending 상태로 Admin 승인 대기.';
comment on column public.account_registration_requests.encrypted_password is
  '애플리케이션 레벨 AES로 암호화된 사내 계정 비밀번호. 승인 시 users.encrypted_password로 복사된다. 평문 저장/로깅 금지.';
comment on column public.account_registration_requests.app_password_hash is
  '회원가입 시 설정한 앱 로그인 비밀번호 해시(단방향). 승인 시 users.app_password_hash로 복사된다.';
comment on column public.account_registration_requests.preferred_room_ids is
  '회원가입 신청 시 선택한 선호 회의실 ID 배열. 순서가 우선순위(인덱스 0 = 1순위). 승인 시 user_preferred_rooms로 옮겨진다.';


-- -----------------------------------------------------------------------------
-- 4. Room (회의실)
-- -----------------------------------------------------------------------------
-- 사업장(Site) -> 층(Floor) -> 회의실(Room) 3단계 계층 중 실제 예약 최소 단위.
-- 1차 범위는 상암S시티로 고정.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),

  -- 1차 범위는 상암S시티 단일 사업장으로 고정 (도메인 문서 6번).
  -- 값이 하나뿐이므로 별도 enum/테이블 없이 텍스트 + check로 충분 (오버엔지니어링 방지).
  site text not null default '상암S시티' check (site = '상암S시티'),

  area_code text not null,        -- 건물 코드 (CJ 시스템 값, 예: 'XXX')
  sub_area_code text not null,    -- 층 코드 (CJ 시스템 값, 예: 'XXXX')
  room_code text not null unique, -- 회의실 코드 (CJ 시스템 값, 예: 'XXXX') - 예약 API의 실제 식별자

  room_name text not null,        -- 회의실 이름 (예: '3F-1', '12F-3')
  floor_label text,               -- 층 표기 (예: '3F', '12F') - 사람이 읽기 편한 참고용
  capacity int,                   -- 수용 인원

  -- B1F/2F 등 실사용 회의실이 아닌 층은 데이터를 아예 넣지 않거나(권장),
  -- 이미 들어간 경우를 대비해 false로 예약 후보 풀에서 제외할 수 있는 안전장치.
  is_bookable boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (area_code, sub_area_code, room_code)
);

create index if not exists rooms_is_bookable_idx on public.rooms (is_bookable);

comment on table public.rooms is
  '예약 가능한 회의실 목록 (상암S시티 3F, 12F~16F). B1F/2F는 넣지 않거나 is_bookable=false로 제외.';

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row
  execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. UserPreferredRoom (User의 선호 회의실 목록, 우선순위 순서)
-- -----------------------------------------------------------------------------
-- User 엔티티 속성(선호 회의실 목록)이지만 배열 컬럼 대신 별도 테이블로 정규화한다:
--  - 우선순위(priority) 정렬/조회가 쉬움
--  - 나중에 회의실이 삭제/변경돼도 FK로 정합성 유지 가능
--  - "이 사용자가 등록한 선호 회의실"은 room_id로 정확히 고정해야 하므로 FK가 적합함

create table if not exists public.user_preferred_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  priority int not null,  -- 1이 최우선

  created_at timestamptz not null default now(),

  unique (user_id, room_id),
  unique (user_id, priority)
);

comment on table public.user_preferred_rooms is
  '사용자별 선호 회의실 우선순위 목록. 가입 시 등록, Agent가 예약 조회 시 이 순서대로 먼저 확인.';


-- -----------------------------------------------------------------------------
-- 6. ReservationRequest / Reservation / AlternativeSuggestion
-- -----------------------------------------------------------------------------
-- ReservationRequest: 챗봇에 입력한 원본 조건.
-- Reservation: 확정된 예약 건. CJ 사내 예약 시스템의 seq(예약 고유번호)를 저장해
--   변경/취소 시 SaveReserve/delReserve 호출의 근거로 사용한다.
-- AlternativeSuggestion: 충돌 시 제시한 대안 목록.
--
-- 참고: 대화 이력 자체(챗봇 메시지 원문 등)는 이 프로젝트 원칙상 장기 저장하지 않는다.
-- 여기 저장하는 것은 "예약 요청의 구조화된 조건값"과 "확정된 예약"뿐이다.

create table if not exists public.reservation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  title text not null,      -- 회의명
  contents text,            -- 내용 (CJ 시스템상 필수지만 챗봇 입력 매핑 정책은 서버 로직에서 처리)

  desired_date date not null,
  desired_start_time time not null,
  desired_end_time time not null,

  status text not null default 'received'
    check (status in ('received', 'availability_checked', 'confirmed', 'conflict', 'cancelled')),

  -- 성공 시 참조할 확정 Reservation (선택적, 1:0..1 관계).
  -- 주의: "동일 사용자+동일 회의실 하루 2시간" 제한 때문에 2시간을 넘는 요청은 서로 다른
  -- 회의실 여러 건으로 분할 예약된다(도메인 문서 2번 "긴 회의 요청" 참고). 분할된 경우
  -- 이 컬럼 하나로는 어느 예약을 가리켜야 할지 모호하므로 null로 남겨두고, 대신
  -- reservations.reservation_request_id(다대일, 역방향)를 소스오브트루스로 사용한다.
  -- 하나의 요청에 연결된 모든 reservations 행을 조회하면 분할된 예약 전체를 얻을 수 있다.
  -- 즉 이 컬럼은 "분할 없이 1건으로 끝난 요청"에 대한 편의 컬럼일 뿐이다.
  reservation_id uuid,

  created_at timestamptz not null default now(),

  constraint reservation_requests_time_order check (desired_end_time > desired_start_time)
);

create index if not exists reservation_requests_user_id_idx on public.reservation_requests (user_id);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),

  reservation_request_id uuid references public.reservation_requests(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id),

  -- CJ 사내 예약 시스템의 예약 고유번호(seq). 변경/취소 시 이 값으로 SaveReserve/delReserve 호출.
  cj_seq text unique,

  title text not null,
  contents text,

  start_at timestamptz not null,
  end_at timestamptz not null,

  status text not null default 'confirmed'
    check (status in ('confirmed', 'modified', 'cancelled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reservations_time_order check (end_at > start_at)
);

create index if not exists reservations_user_id_idx on public.reservations (user_id);
create index if not exists reservations_room_id_idx on public.reservations (room_id);

comment on table public.reservations is
  '확정된 예약. 30분 단위/2시간 제한/일일 건수 제한 등 CJ 시스템 자체 규칙은 예약 생성 API 호출 전에 서버 로직이 검증하며, DB는 이를 다시 강제하지 않는다. 다만 같은 회의실+겹치는 시간대 중복 예약 금지는 DB에서도 EXCLUDE 제약으로 이중 방어한다.';

-- 동일 회의실, 겹치는 시간대에는 취소되지 않은 예약이 두 건 이상 존재할 수 없다.
alter table public.reservations
  add constraint reservations_no_overlap
  exclude using gist (
    room_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status <> 'cancelled');

create trigger reservations_set_updated_at
  before update on public.reservations
  for each row
  execute function public.set_updated_at();

-- reservation_requests.reservation_id -> reservations.id FK
-- (reservations 테이블 생성 이후에만 걸 수 있어 여기서 별도로 추가한다)
alter table public.reservation_requests
  add constraint reservation_requests_reservation_id_fkey
  foreign key (reservation_id) references public.reservations(id) on delete set null;

create table if not exists public.alternative_suggestions (
  id uuid primary key default gen_random_uuid(),
  reservation_request_id uuid not null references public.reservation_requests(id) on delete cascade,
  room_id uuid not null references public.rooms(id),

  suggested_start_at timestamptz not null,
  suggested_end_at timestamptz not null,
  rank int not null,          -- 우선순위/유사도 순서 (1이 가장 추천)
  is_selected boolean not null default false,

  created_at timestamptz not null default now(),

  constraint alternative_suggestions_time_order check (suggested_end_at > suggested_start_at)
);

create index if not exists alternative_suggestions_request_id_idx
  on public.alternative_suggestions (reservation_request_id);


-- -----------------------------------------------------------------------------
-- 6-1. RefreshToken (Refresh Token 발급 이력)
-- -----------------------------------------------------------------------------
-- docs/4-prd.md "인증/보안": Access Token(짧은 만료, 응답 바디) + Refresh Token(httpOnly
-- Secure SameSite 쿠키) 방식. Refresh Token은 서버가 개별/전체 폐기(revoke)할 수 있어야
-- 하므로 발급 이력을 DB에 남긴다.
--
-- 토큰 원문이 아니라 해시값만 저장한다 (평문 비밀정보를 어디에도 남기지 않는다는 원칙과 동일).
-- 개별 로그아웃은 해당 토큰 한 건만, 비밀번호 변경/보안사고 대응 시 전체 폐기는 해당
-- user_id의 폐기 안 된(revoked=false) 토큰 전체를 UPDATE 한 번으로 처리한다 (별도 함수 불필요).
--
-- 만료 토큰을 주기적으로 정리하는 배치는 이번 스코프가 아니다 (오버엔지니어링 방지, 필요 시 추후 추가).

create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- Refresh Token 원문이 아니라 해시값만 저장 (예: SHA-256).
  token_hash text not null unique,

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,

  revoked boolean not null default false,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint refresh_tokens_revoked_at_consistency check (
    (revoked = false and revoked_at is null)
    or (revoked = true and revoked_at is not null)
  )
);

-- 로그인 시점에 "이 사용자의 유효한(폐기 안 된) 토큰"을 조회/전체 폐기하는 쿼리를 위한 인덱스.
create index if not exists refresh_tokens_user_id_revoked_idx
  on public.refresh_tokens (user_id, revoked);

comment on table public.refresh_tokens is
  'Refresh Token 발급 이력. 토큰 원문이 아니라 해시값만 저장한다. 개별 로그아웃 시 해당 행 하나를,
   비밀번호 변경/보안사고 대응 시 해당 user_id의 폐기 안 된 행 전체를 UPDATE로 폐기 처리한다.';
comment on column public.refresh_tokens.token_hash is
  'Refresh Token 원문의 해시값(예: SHA-256). 평문 토큰은 DB에 저장하지 않는다.';

-- [20260816 추가] 챗봇 오케스트레이션 세션(대화 이력 + 확인대기 상태). 상세 근거는
-- supabase/migrations/20260816000000_chat_sessions.sql 참고 — 서버리스 배포 시 함수
-- 인스턴스가 바뀌어도 대화 기억이 유지되도록 in-memory Map을 대체한다.
create table if not exists public.chat_sessions (
  user_id uuid primary key references public.users(id) on delete cascade,
  state jsonb not null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.chat_sessions is
  '사용자별 챗봇 오케스트레이션 세션(대화 이력 + 확인대기 상태). Vercel 서버리스에서 함수
   인스턴스가 바뀌어도 대화 기억이 유지되도록 sessionStore.ts의 in-memory Map을 대체한다.';
comment on column public.chat_sessions.state is
  'OrchestrationSession 전체를 그대로 직렬화한 jsonb (messages/pendingConfirmation/offeredSlots 등).';


-- -----------------------------------------------------------------------------
-- 6-2. RecurringReservationRule / RecurringReservationRuleRoom / RecurringReservationRun
--       (매주 반복 예약)
-- -----------------------------------------------------------------------------
-- [배경] CJ 시스템은 오늘~7일 뒤까지만 예약을 받는다(backend/src/tools/businessRules.ts의
-- MAX_ADVANCE_DAYS = 7). 그래서 "매주 화요일 3개월치"처럼 먼 미래 예약을 CJ에 한 번에
-- 미리 넣어둘 방법이 없다. 대신 사용자가 "요일/시간/회의실 우선순위" 같은 반복 규칙만
-- 등록해두면, 서버는 대상일이 예약 가능 범위(7일 전)에 들어오는 순간(대상일 00:01)
-- Windows 작업 스케줄러로 잡을 돌려 그때 실제 CJ 예약을 생성하는 구조다. 사용자가 앱을
-- 열어보지 않은 상태에서도 실행돼야 하므로, 서버가 그 사용자의 CJ 계정으로 무인 로그인을
-- 수행하며 이에 대한 별도 동의 기록은 users.unattended_booking_consent_at(위 2번 참고)이 담당한다.
--
-- 상세 설계 근거: supabase/migrations/20260817000000_recurring_reservations.sql

create table if not exists public.recurring_reservation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- 0=일요일 ~ 6=토요일. JS Date.getDay() 규약을 그대로 따른다(별도 enum/매핑 테이블 없이
  -- 백엔드 Node.js 코드와 값 변환 없이 바로 맞물리게 하기 위함).
  weekday smallint not null check (weekday between 0 and 6),

  start_time time not null,
  end_time time not null,

  title text not null,
  contents text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurring_reservation_rules_time_order check (end_time > start_time)
);

create index if not exists recurring_reservation_rules_user_id_idx
  on public.recurring_reservation_rules (user_id);

create index if not exists recurring_reservation_rules_weekday_active_idx
  on public.recurring_reservation_rules (weekday, is_active);

comment on table public.recurring_reservation_rules is
  '사용자가 등록한 매주 반복 예약 규칙. CJ는 7일 뒤까지만 예약을 받으므로 여기 저장된 규칙 자체는
   CJ에 아직 반영되지 않은 "의도"이고, 실제 예약 생성은 대상일이 예약 가능 범위에 들어올 때마다
   Windows 작업 스케줄러가 recurring_reservation_runs를 통해 수행한다.';

create trigger recurring_reservation_rules_set_updated_at
  before update on public.recurring_reservation_rules
  for each row
  execute function public.set_updated_at();

-- [user_preferred_rooms와의 차이 - 반드시 구분할 것] 기존 user_preferred_rooms는 사용자
-- 전역 선호도(평소 예약 추천/정렬용)이고, 이 테이블은 "이 반복 규칙 하나를 실행할 때 몇
-- 순위 회의실부터 시도할지"를 나타내는 규칙 단위 시도 순서다. 같은 사용자라도 반복 규칙마다
-- 시도 순서가 다를 수 있어 별도 테이블로 두되, "우선순위 있는 회의실 목록"이라는 성격이
-- 같으므로 제약 구조(unique 2개)는 user_preferred_rooms와 의도적으로 동일하게 맞췄다.

create table if not exists public.recurring_reservation_rule_rooms (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_reservation_rules(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  priority int not null,  -- 1이 최우선

  created_at timestamptz not null default now(),

  unique (rule_id, room_id),
  unique (rule_id, priority)
);

comment on table public.recurring_reservation_rule_rooms is
  '반복 예약 규칙별 회의실 시도 순서(1~3순위). user_preferred_rooms(사용자 전역 선호도)와는
   목적이 다른 규칙 단위 속성이다.';

-- [unique (rule_id, target_date)가 멱등성 키인 이유] Windows 작업 스케줄러는 PC 재부팅,
-- 잡 재실행 등으로 같은 (규칙, 대상일) 조합을 두 번 실행할 수 있다. 이 제약이 없으면 같은
-- 시간대에 같은 회의실을 중복 예약 시도할 위험이 있다. 잡 코드는 실행 전 기존 row 존재
-- 여부로 "이미 처리됨"을 판단한다.

create table if not exists public.recurring_reservation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_reservation_rules(id) on delete cascade,

  target_date date not null,

  status text not null check (status in ('succeeded', 'failed', 'skipped')),

  reservation_id uuid references public.reservations(id) on delete set null,
  booked_room_id uuid references public.rooms(id),

  attempted_priority int,   -- recurring_reservation_rule_rooms.priority 중 몇 순위로 성공/시도했는지
  failure_reason text,

  executed_at timestamptz not null default now(),

  unique (rule_id, target_date)
);

create index if not exists recurring_reservation_runs_rule_id_executed_at_idx
  on public.recurring_reservation_runs (rule_id, executed_at desc);

comment on table public.recurring_reservation_runs is
  '반복 예약 규칙이 대상일마다 실제로 실행된 기록. unique (rule_id, target_date)가 멱등성 키로,
   Windows 작업 스케줄러 중복 실행으로 인한 CJ 중복 예약을 막는다.';


-- -----------------------------------------------------------------------------
-- 7. 계정 등록 요청 승인/거부 함수
-- -----------------------------------------------------------------------------
-- [설계 결정] 화이트리스트 대조 로직 자체는 DB 트리거가 아니라 "서버 코드"에서 수행한다. 이유:
--   1) 화이트리스트 미해당 시 Admin 전원에게 알림 메일을 보내야 하는데, 이는 외부 이메일 서비스 호출이
--      필요한 부수효과(side effect)라서 DB 트리거 안에서 처리하기에 적합하지 않다 (트리거는 순수 DB 로직에 적합).
--   2) 화이트리스트 매칭은 단순 SELECT 1건으로 충분해 서버 코드에 둬도 복잡하지 않다.
--   3) 승인/거부 로직을 서버 코드에 두면 테스트/버전관리가 쉽고, DB에는 숨은 마법이 남지 않는다.
--
-- 다만 "승인 결정 후 User 생성 + 요청 상태 갱신"은 여러 테이블에 걸친 원자적 트랜잭션이 필요하고,
-- Supabase REST(PostgREST)로는 클라이언트에서 여러 테이블 쓰기를 하나의 트랜잭션으로 묶기 어렵다.
-- 그래서 이 부분만 RPC 함수로 만들어 원자성을 보장한다 (트리거가 아니라 명시적으로 호출되는 함수).
-- 이 함수는 service role로만 호출된다 (봇 백엔드 / Admin 패널 백엔드) — 아래 REVOKE로 강제한다.
--
-- [보안 수정, 20260813001200] 원래 이 함수는 호출자가 넘긴 p_is_auto를 그대로 믿고 is_admin에
-- 반영했고, EXECUTE 권한도 회수돼 있지 않아 anon key로 직접 호출해 Admin을 자체 부여할 수
-- 있었다. 지금은 (1) 자동승인 여부를 admin_whitelist 재조회로 함수가 직접 판단하고,
-- (2) 수동 승인 시 p_admin_user_id가 실제 활성 Admin인지 DB가 검증하며,
-- (3) public/anon/authenticated의 EXECUTE 권한을 회수한다.

create or replace function public.approve_account_registration_request(
  p_request_id uuid,
  p_admin_user_id uuid default null  -- 수동 승인인 경우 처리한 Admin의 users.id. 화이트리스트 자동승인이면 NULL.
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.account_registration_requests%rowtype;
  v_new_user_id uuid;
  v_is_whitelisted boolean;
  v_is_auto boolean;
begin
  select * into v_request
  from public.account_registration_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'account_registration_requests not found: %', p_request_id;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'request % is not pending (current status: %)', p_request_id, v_request.status;
  end if;

  if v_request.app_password_hash is null then
    raise exception 'request % has no app_password_hash set', p_request_id;
  end if;

  -- 자동승인 여부는 호출자 입력이 아니라 화이트리스트를 직접 재조회해서 결정한다.
  select exists(
    select 1 from public.admin_whitelist w where w.email_alias = v_request.email_alias
  ) into v_is_whitelisted;

  if v_is_whitelisted then
    v_is_auto := true;
  else
    v_is_auto := false;
    if p_admin_user_id is null then
      raise exception 'request % is not whitelisted and requires manual approval by an admin', p_request_id;
    end if;
    if not exists (
      select 1 from public.users u
      where u.id = p_admin_user_id and u.is_admin = true and u.status = 'active'
    ) then
      raise exception 'p_admin_user_id % is not an active admin', p_admin_user_id;
    end if;
  end if;

  insert into public.users (telegram_user_id, email_alias, encrypted_password, app_password_hash, is_admin, status)
  values (v_request.telegram_user_id, v_request.email_alias, v_request.encrypted_password, v_request.app_password_hash, v_is_auto, 'active')
  returning id into v_new_user_id;

  update public.account_registration_requests
  set status = case when v_is_auto then 'auto_approved' else 'approved' end,
      processed_by_system = v_is_auto,
      processed_by_user_id = case when v_is_auto then null else p_admin_user_id end,
      processed_at = now(),
      resulting_user_id = v_new_user_id
  where id = p_request_id;

  return v_new_user_id;
end;
$$;

comment on function public.approve_account_registration_request is
  '계정 등록 요청 승인. 자동승인 여부는 admin_whitelist를 직접 재조회해서 판단하며(호출자 입력을 신뢰하지 않음),
   수동 승인 시 p_admin_user_id가 실제 활성 Admin인지 DB가 검증한다. service role 전용(REVOKE 적용됨).';

create or replace function public.reject_account_registration_request(
  p_request_id uuid,
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = p_admin_user_id and u.is_admin = true and u.status = 'active'
  ) then
    raise exception 'p_admin_user_id % is not an active admin', p_admin_user_id;
  end if;

  -- 거부 시 자격증명(사내 계정 비밀번호 + 앱 로그인 비밀번호)은 즉시 폐기한다.
  update public.account_registration_requests
  set status = 'rejected',
      processed_by_system = false,
      processed_by_user_id = p_admin_user_id,
      processed_at = now(),
      encrypted_password = '',
      app_password_hash = null
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'request % not found or not pending', p_request_id;
  end if;
end;
$$;

comment on function public.reject_account_registration_request is
  '계정 등록 요청 거부. 암호화된 사내 계정 비밀번호와 앱 로그인 비밀번호 해시를 즉시 폐기한다.
   p_admin_user_id가 실제 활성 Admin인지 DB가 검증한다. service role 전용(REVOKE 적용됨).';

-- 세 함수 모두 public/anon/authenticated의 EXECUTE 권한을 회수한다. service_role은 이 목록에
-- 없으므로 신뢰된 백엔드(Admin 패널/봇 백엔드)는 계속 호출 가능하다. get_user_frequent_rooms는
-- 이 파일 아래쪽에서 정의되므로, 해당 REVOKE 문도 그 정의 바로 다음에 함께 둔다.
revoke execute on function public.approve_account_registration_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reject_account_registration_request(uuid, uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 8. "자주 쓰던 회의실" 조회 함수
-- -----------------------------------------------------------------------------
-- User.선호 회의실(user_preferred_rooms)은 가입 시 "사용자가 직접 등록한" 우선순위 목록이다.
-- 반면 "내가 자주 쓰던 회의실로 예약해줘" 같은 자연어 요청은 실제 예약 이력 기준일 수도 있다.
-- 새 테이블 없이 기존 reservations 데이터를 집계해서 답한다 (오버엔지니어링 방지).
--
-- LLM 오케스트레이션 계층의 사용 순서 권장:
--   1) user_preferred_rooms에 등록된 선호 회의실이 있으면 그것을 1순위로 사용.
--   2) 등록된 선호 회의실이 없거나, 사용자가 "자주 쓰던/평소 쓰던"처럼 이력 기반 표현을 쓰면
--      이 함수의 결과(top 1~3)를 후보로 사용.

create or replace function public.get_user_frequent_rooms(
  p_user_id uuid,
  p_limit int default 3
)
returns table (
  room_id uuid,
  reservation_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.room_id, count(*) as reservation_count
  from public.reservations r
  where r.user_id = p_user_id
    and r.status <> 'cancelled'
  group by r.room_id
  order by reservation_count desc, r.room_id
  limit greatest(p_limit, 1);
$$;

comment on function public.get_user_frequent_rooms is
  '사용자의 취소되지 않은 예약을 회의실별로 집계해 예약 횟수가 많은 순으로 반환한다. 이력 기반 자연어 요청에 사용. service role 전용(REVOKE 적용됨).';

-- [보안 수정, 20260813001200] 이 함수도 REVOKE가 없어 anon key로 임의의 user_id를 넣어
-- 다른 사람의 예약 이력을 조회할 수 있었다. public/anon/authenticated의 EXECUTE 권한을 회수한다.
revoke execute on function public.get_user_frequent_rooms(uuid, int) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. Row Level Security (RLS) 정책
-- -----------------------------------------------------------------------------
-- [아키텍처 전제] 이 시스템의 실제 클라이언트는 두 종류뿐이다.
--   1) 회원가입 웹페이지 (Vercel, 공개, anon key) - 사내 계정 ID/PW, 앱 로그인 비밀번호,
--      선호 회의실을 받아 account_registration_requests에 INSERT만 한다.
--      로그인 전 익명 공개 폼이라 RLS 관점에서는 anon 역할로 취급한다.
--   2) 백엔드 API 서버 / Admin 패널 백엔드 (신뢰된 서버, service role key) - 로그인(JWT
--      발급/재발급), 실제 예약 로직, 화이트리스트 대조, 승인/거부 처리 등 민감한 작업을
--      전부 수행한다. 이 서비스의 로그인은 Supabase Auth가 아니라 자체 JWT(access+refresh)
--      방식이므로, 로그인한 사용자도 Supabase 세션(auth.uid())을 들고 있지 않다. 따라서
--      "auth.uid() = users.id" 형태의 표준 RLS 패턴은 이 아키텍처에 맞지 않는다.
--
--   "사용자는 본인 데이터만 접근 가능"이라는 요구사항은 여기서는 DB 세션 단위가 아니라
--   "신뢰된 백엔드가 JWT에서 검증한 user_id로 필터링해서 접근한다"는 애플리케이션 레벨
--   보장으로 구현된다 (백엔드는 service role key로 RLS를 우회하되, 항상 요청자의
--   user_id로 WHERE 필터링한 쿼리만 실행하도록 서버 코드에서 강제한다).
--
--   즉 RLS의 실질적 역할은 공개 anon key로 노출된 회원가입 웹페이지가 실수로/악의적으로
--   다른 사람의 데이터를 읽거나 쓰지 못하게 막는 것이다. anon/authenticated 롤에는 꼭
--   필요한 최소 권한(등록 신청 INSERT, 예약 가능 회의실 목록 SELECT)만 열어주고, 나머지는
--   정책을 아예 만들지 않아 기본값(모두 거부)으로 막는다. service role은 RLS를 우회하므로
--   모든 정책과 무관하게 항상 접근 가능하다.
--
--   (참고: 나중에 사용자용 마이페이지를 Supabase Auth 세션 기반으로 바꾸게 되면 auth.uid()
--   매핑 컬럼과 정책을 추가하면 된다. 지금 요구사항에는 없으므로 미리 만들어두지 않는다
--   - 오버엔지니어링 방지.)

alter table public.users enable row level security;
alter table public.admin_whitelist enable row level security;
alter table public.account_registration_requests enable row level security;
alter table public.rooms enable row level security;
alter table public.user_preferred_rooms enable row level security;
alter table public.reservation_requests enable row level security;
alter table public.reservations enable row level security;
alter table public.alternative_suggestions enable row level security;
alter table public.refresh_tokens enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.recurring_reservation_rules enable row level security;
alter table public.recurring_reservation_rule_rooms enable row level security;
alter table public.recurring_reservation_runs enable row level security;

-- rooms: 회원가입 웹페이지가 "선호 회의실" 선택 UI를 보여주기 위해 예약 가능한 회의실 목록을
-- anon key로 읽을 수 있어야 한다. 민감정보가 아니므로 공개 조회를 허용한다.
create policy rooms_public_read_bookable
  on public.rooms
  for select
  to anon, authenticated
  using (is_bookable = true);

-- account_registration_requests: 누구나(anon) 등록 신청을 "생성"할 수 있어야 한다 (공개 폼).
-- 단, 신청 직후 상태는 반드시 pending이고 텔레그램 연동 전(telegram_user_id NULL)이어야 하며,
-- 승인/거부 관련 컬럼은 절대 클라이언트가 직접 채울 수 없다.
create policy account_registration_requests_public_insert
  on public.account_registration_requests
  for insert
  to anon
  with check (
    status = 'pending'
    and telegram_user_id is null
    and processed_by_user_id is null
    and processed_by_system = false
    and processed_at is null
    and resulting_user_id is null
  );

-- SELECT/UPDATE/DELETE 정책은 anon/authenticated에 대해 만들지 않는다.
-- 본인 비밀번호(암호화본/해시 포함)를 포함해 신청 내역을 다시 읽거나 고치는 것은
-- 회원가입 웹페이지에서 불가능하며, Admin 승인/거부는 오직 service role을 쓰는
-- 신뢰된 백엔드(Admin 패널 백엔드)에서만 수행된다. 이것이 "Admin만 승인/거부 가능"의
-- 실질적 강제 지점이다: RLS가 아니라 service role key를 가진 것은 신뢰된 백엔드뿐이라는
-- 키 분리 + 백엔드 자체의 Admin 인증(JWT + is_admin 검증)으로 보장한다.

-- users, admin_whitelist, user_preferred_rooms, reservation_requests, reservations,
-- alternative_suggestions, refresh_tokens, chat_sessions, recurring_reservation_rules,
-- recurring_reservation_rule_rooms, recurring_reservation_runs: anon/authenticated용 정책을
-- 전혀 만들지 않는다. RLS가 켜져 있고 정책이 없으면 기본값은 "모두 거부"이므로, 이
-- 테이블들은 anon/authenticated 키로는 어떤 행도 읽거나 쓸 수 없다. service role key를
-- 쓰는 백엔드만 접근 가능하며, "사용자는 자기 자신의 데이터만" 원칙은 백엔드가 JWT의
-- user_id로 매번 WHERE 필터링하는 애플리케이션 레벨 로직으로 강제한다 (위 아키텍처 전제 참고).
