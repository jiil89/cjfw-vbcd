-- "자주 쓰던 회의실" 조회 함수.
--
-- User.선호 회의실(user_preferred_rooms)은 가입 시 "사용자가 직접 등록한" 우선순위 목록이다.
-- 반면 "내가 자주 쓰던 회의실로 예약해줘" 같은 자연어 요청은 실제 예약 이력 기준일 수도 있다.
-- 새 테이블 없이 기존 reservations 데이터를 집계해서 answer한다 (오버엔지니어링 방지).
--
-- LLM 오케스트레이션 계층의 사용 순서 권장:
--   1) user_preferred_rooms 에 등록된 선호 회의실이 있으면 그것을 1순위로 사용.
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
  '사용자의 취소되지 않은 예약을 회의실별로 집계해 예약 횟수가 많은 순으로 반환한다.
   "자주 쓰던 회의실" 같은 이력 기반 자연어 요청에 사용. service role 전용(anon/authenticated 정책 없음).';
