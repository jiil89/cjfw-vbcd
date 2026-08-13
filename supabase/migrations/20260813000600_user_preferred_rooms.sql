-- User.선호 회의실 목록(우선순위 순서).
-- User 엔티티 속성이지만 배열 컬럼 대신 별도 테이블로 정규화한다:
--  - 우선순위(priority) 정렬/조회가 쉬움
--  - 나중에 회의실이 삭제/변경돼도 FK로 정합성 유지 가능
--  - 회의실 이름은 LLM이 유사도로 매칭한다는 원칙(도메인 문서 6번)과 별개로,
--    "이 사용자가 등록한 선호 회의실"은 room_id로 정확히 고정해야 하므로 FK가 적합함

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
