-- ReservationRequest (예약 요청): 챗봇에 입력한 원본 조건.
-- Reservation (예약): 확정된 예약 건. CJ 사내 예약 시스템의 seq(예약 고유번호)를 저장해
--   변경/취소 시 SaveReserve/delReserve 호출의 근거로 사용한다.
-- AlternativeSuggestion (대체 추천): 충돌 시 제시한 대안 목록.
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
  '확정된 예약. 30분 단위/2시간 제한/일일 건수 제한 등 CJ 시스템 자체 규칙은 예약 생성 API(SaveReserve) 호출 전에
   서버 로직이 검증하며, DB는 이를 다시 강제하지 않는다 (외부 시스템과 다른 소스오브트루스를 만들지 않기 위함).
   다만 "같은 회의실 + 겹치는 시간대 중복 예약 금지"는 DB에서도 EXCLUDE 제약으로 이중 방어한다.';

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

-- reservation_requests가 성공 시 참조할 확정 Reservation (선택적, 1:0..1 관계).
-- 주의: "동일 사용자+동일 회의실 하루 2시간" 제한 때문에 2시간을 넘는 요청은 서로 다른
-- 회의실 여러 건으로 분할 예약된다(도메인 문서 2번 "긴 회의 요청" 참고). 분할된 경우
-- 이 컬럼 하나로는 어느 예약을 가리켜야 할지 모호하므로 null로 남겨두고, 대신 위
-- reservations.reservation_request_id(다대일, 역방향)를 소스오브트루스로 사용한다 —
-- 하나의 요청에 연결된 모든 reservations 행을 조회하면 분할된 예약 전체를 얻을 수 있다.
-- 즉 이 컬럼은 "분할 없이 1건으로 끝난 요청"에 대한 편의 컬럼일 뿐이다.
alter table public.reservation_requests
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null;

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
