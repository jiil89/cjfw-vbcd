-- 매주 반복 예약(Recurring Reservation) 기능.
--
-- [배경] CJ 시스템은 오늘~7일 뒤까지만 예약을 받는다(backend/src/tools/businessRules.ts의
-- MAX_ADVANCE_DAYS = 7). 그래서 "매주 화요일 3개월치"처럼 먼 미래 예약을 CJ에 한 번에
-- 미리 넣어둘 방법이 없다. 대신 사용자가 "요일/시간/회의실 우선순위" 같은 반복 규칙만
-- 등록해두면, 서버는 대상일이 예약 가능 범위(7일 전)에 들어오는 순간(대상일 00:01)
-- Windows 작업 스케줄러로 잡을 돌려 그때 실제 CJ 예약을 생성하는 구조다.
--
-- [무인 로그인과 동의] 이 잡은 사용자가 앱을 열어보지 않은 상태에서도 실행돼야 하므로,
-- 서버가 그 사용자의 CJ 계정으로 무인(unattended) 로그인을 수행한다. 평소의 "사용자가
-- 직접 챗봇에 요청 -> 그 요청 처리를 위해 CJ 로그인"과 달리, 이건 사람의 개입 없이
-- 서버가 스스로 트리거하는 로그인이므로 별도의 명시적 동의 기록을 users 테이블에 남긴다.

-- (1) users: 무인 예약 동의 기록 2개 컬럼 추가.
-- 기존 status/revoked_at 패턴(20260813000300_users.sql)과 동일한 결로, "동의함/철회함"을
-- boolean 플래그가 아니라 시각(timestamptz)으로 남겨 언제 동의/철회했는지 감사 추적이 되게 한다.
-- 유효한 동의 여부는 애플리케이션에서 다음으로 판단한다:
--   unattended_booking_consent_at is not null and unattended_booking_consent_revoked_at is null
alter table public.users
  add column if not exists unattended_booking_consent_at timestamptz,
  add column if not exists unattended_booking_consent_revoked_at timestamptz;

comment on column public.users.unattended_booking_consent_at is
  '매주 반복 예약을 위해 서버가 사용자 CJ 계정으로 무인 로그인하는 것에 동의한 시각. 반복 예약 규칙을 만들려면 이 동의가 유효해야 한다(철회 안 됨).';
comment on column public.users.unattended_booking_consent_revoked_at is
  '무인 로그인 동의를 철회한 시각. NULL이면 아직 철회 안 함. 철회되면 그 시점부터 이 사용자의 반복 예약 실행을 중단해야 한다(서버 로직에서 강제).';


-- (2) RecurringReservationRule: 반복 예약 규칙 본체.
-- "매주 화요일 14:00~15:00, 회의명 OO"처럼 사용자가 등록한 반복 조건 자체를 저장한다.
-- 이 테이블은 CJ에 실제로 예약을 넣지 않는다 - 그건 (4) recurring_reservation_runs가
-- 대상일마다 실행한 결과를 기록하는 별개의 일이다.

create table if not exists public.recurring_reservation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- 0=일요일 ~ 6=토요일. JS Date.getDay() 규약을 그대로 따른다(백엔드가 Node.js라 스케줄러
  -- 잡 코드와 값 변환 없이 바로 맞물리게 하기 위함 - 별도 enum/매핑 테이블을 두지 않는다).
  weekday smallint not null check (weekday between 0 and 6),

  start_time time not null,
  end_time time not null,

  title text not null,       -- 회의명
  contents text,             -- 내용 (reservations.contents와 동일하게 선택 입력)

  -- 규칙을 삭제하지 않고 잠시/영구 중단하고 싶을 때 쓰는 스위치. 스케줄러 잡은 이 값이
  -- true인 규칙만 대상으로 실행한다.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recurring_reservation_rules_time_order check (end_time > start_time)
);

create index if not exists recurring_reservation_rules_user_id_idx
  on public.recurring_reservation_rules (user_id);

-- 스케줄러 잡이 "오늘 기준 대상일의 weekday에 해당하는 활성 규칙"을 조회할 때 쓰는 인덱스.
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


-- (3) RecurringReservationRuleRoom: 규칙별 회의실 시도 순서(1~3순위).
--
-- [user_preferred_rooms와의 차이 - 반드시 구분할 것] 기존 user_preferred_rooms는 "이 사용자가
-- 전반적으로 선호하는 회의실"을 나타내는 사용자 전역 속성으로, 챗봇이 평소 예약을 추천/정렬할
-- 때 쓰인다. 이 테이블은 그것과 다르다 - "이 반복 규칙 하나를 실행할 때 몇 순위 회의실부터
-- 시도할지"를 나타내는 규칙 단위 속성이다. 같은 사용자라도 반복 규칙마다(예: "화요일 정기회의"는
-- 3F-1을, "목요일 스탠드업"은 12F-2를 선호) 시도 순서가 다를 수 있어 user_preferred_rooms를
-- 재사용하지 않고 별도 테이블로 둔다. 다만 "우선순위(priority) 있는 회의실 목록"이라는 성격은
-- 동일하므로 제약 구조(unique 2개)는 user_preferred_rooms와 의도적으로 동일하게 맞췄다.

create table if not exists public.recurring_reservation_rule_rooms (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_reservation_rules(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  priority int not null,  -- 1이 최우선. 스케줄러 잡이 이 순서대로 CJ 가용성을 확인해 시도한다.

  created_at timestamptz not null default now(),

  unique (rule_id, room_id),
  unique (rule_id, priority)
);

comment on table public.recurring_reservation_rule_rooms is
  '반복 예약 규칙별 회의실 시도 순서(1~3순위). user_preferred_rooms(사용자 전역 선호도)와는
   목적이 다른 규칙 단위 속성이다 - 자세한 이유는 이 파일 상단 (3) 주석 참고.';


-- (4) RecurringReservationRun: 대상일마다 스케줄러 잡이 실행한 기록 + 멱등성 키.
--
-- [unique (rule_id, target_date)가 멱등성 키인 이유] Windows 작업 스케줄러는 PC 재부팅,
-- 잡 재실행, 중복 트리거 등으로 같은 (규칙, 대상일) 조합에 대해 두 번 실행될 수 있다.
-- 이 unique 제약이 없으면 똑같은 시간대에 같은 회의실을 두 번 예약 시도해 CJ에 중복
-- 예약이 생기거나, 이미 성공 처리된 건을 또 실행해 불필요한 CJ 호출이 발생할 수 있다.
-- 잡 코드는 실행 전 이 (rule_id, target_date)로 기존 row가 있는지 먼저 확인하고, 없을
-- 때만(또는 INSERT 시 unique violation을 "이미 처리됨"으로 해석해) 실제 예약을 시도한다.

create table if not exists public.recurring_reservation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_reservation_rules(id) on delete cascade,

  target_date date not null,  -- 이 실행이 예약하려 한 실제 날짜(규칙의 weekday에 해당하는 그 주의 날짜)

  status text not null check (status in ('succeeded', 'failed', 'skipped')),

  -- 성공 시 생성된 확정 예약과 실제로 잡힌 회의실. 실패/스킵이면 둘 다 NULL.
  reservation_id uuid references public.reservations(id) on delete set null,
  booked_room_id uuid references public.rooms(id),

  -- recurring_reservation_rule_rooms.priority 중 몇 순위 회의실로 성공/시도했는지 (감사/디버깅용).
  attempted_priority int,

  -- 실패/스킵 사유(예: "1~3순위 회의실 모두 마감", "CJ 무인 로그인 실패", "동의 철회됨" 등).
  failure_reason text,

  executed_at timestamptz not null default now(),

  unique (rule_id, target_date)
);

-- 특정 규칙의 최근 실행 이력을 시간순으로 조회(예: "최근 실행 언제/성공했는지")할 때 쓰는 인덱스.
create index if not exists recurring_reservation_runs_rule_id_executed_at_idx
  on public.recurring_reservation_runs (rule_id, executed_at desc);

comment on table public.recurring_reservation_runs is
  '반복 예약 규칙이 대상일마다 실제로 실행된 기록. unique (rule_id, target_date)가 멱등성 키로,
   Windows 작업 스케줄러 재실행/PC 재부팅으로 같은 (규칙, 대상일) 조합이 중복 실행되어 CJ에
   중복 예약이 생기는 것을 막는다. 자세한 이유는 이 파일 상단 (4) 주석 참고.';


-- RLS: 세 테이블 모두 활성화만 하고 정책은 만들지 않는다.
-- 반복 예약 규칙 CRUD와 스케줄러 잡의 실행 기록 기록은 전부 신뢰된 백엔드(service role key)만
-- 수행한다 - 사용자용 anon/authenticated 클라이언트가 이 테이블들을 직접 읽거나 쓸 일이 없다
-- (chat_sessions/refresh_tokens와 동일한 근거: RLS가 켜져 있고 정책이 없으면 기본값은
-- "모두 거부"이므로 service role만 접근 가능하고, "본인 규칙만" 원칙은 백엔드가 JWT의
-- user_id로 매번 WHERE 필터링하는 애플리케이션 레벨 로직으로 강제한다).

alter table public.recurring_reservation_rules enable row level security;
alter table public.recurring_reservation_rule_rooms enable row level security;
alter table public.recurring_reservation_runs enable row level security;
