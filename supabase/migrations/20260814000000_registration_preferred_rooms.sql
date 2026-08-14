-- FE-2 선행 작업: 회원가입 신청 시 선호 회의실 우선순위를 함께 받을 수 있도록
-- account_registration_requests에 컬럼을 추가한다. 배열 순서 = 우선순위(인덱스 0이 1순위).
-- 승인 시점(자동/수동 모두)에 애플리케이션 코드가 이 배열을 읽어 user_preferred_rooms에
-- 옮겨 심는다 -- 이 컬럼 자체는 신청 단계의 임시 보관소일 뿐이다.

alter table public.account_registration_requests
  add column if not exists preferred_room_ids uuid[] not null default '{}';

comment on column public.account_registration_requests.preferred_room_ids is
  '회원가입 신청 시 선택한 선호 회의실 ID 배열. 순서가 우선순위(인덱스 0 = 1순위). 승인 시 user_preferred_rooms로 옮겨진다.';
