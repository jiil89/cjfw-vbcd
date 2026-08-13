-- 계정 등록 요청 승인/거부를 원자적으로 처리하는 함수.
--
-- [설계 결정] 화이트리스트 대조 로직 자체는 DB 트리거가 아니라 "서버 코드"에서 수행한다. 이유:
--   1) 화이트리스트 미해당 시 Admin 전원에게 알림 메일을 보내야 하는데, 이는 외부 이메일 서비스 호출이 필요한
--      부수효과(side effect)라서 DB 트리거 안에서 처리하기에 적합하지 않다 (트리거는 순수 DB 로직에 적합).
--   2) 화이트리스트 매칭은 단순 SELECT 1건으로 충분해 서버 코드에 둬도 복잡하지 않다.
--   3) 승인/거부 로직을 서버 코드에 두면 테스트/버전관리가 쉽고, DB에는 "숨은 마법"이 남지 않는다.
--
-- 다만 "승인 결정 후 User 생성 + 요청 상태 갱신"은 여러 테이블에 걸친 원자적 트랜잭션이 필요하고,
-- Supabase REST(PostgREST)로는 클라이언트에서 여러 테이블 쓰기를 하나의 트랜잭션으로 묶기 어렵다.
-- 그래서 이 부분만 RPC 함수로 만들어 원자성을 보장한다 (트리거가 아니라 명시적으로 호출되는 함수).
-- 이 함수는 service role 로만 호출된다 (봇 백엔드 / Admin 패널 백엔드).

create or replace function public.approve_account_registration_request(
  p_request_id uuid,
  p_is_auto boolean,           -- 화이트리스트 자동승인이면 true
  p_admin_user_id uuid default null  -- 수동 승인인 경우 처리한 Admin의 users.id (자동승인이면 null)
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.account_registration_requests%rowtype;
  v_new_user_id uuid;
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

  if v_request.telegram_user_id is null then
    raise exception 'request % has no linked telegram_user_id yet (deeplink not completed)', p_request_id;
  end if;

  if not p_is_auto and p_admin_user_id is null then
    raise exception 'manual approval requires p_admin_user_id';
  end if;

  insert into public.users (telegram_user_id, email_alias, encrypted_password, is_admin, status)
  values (v_request.telegram_user_id, v_request.email_alias, v_request.encrypted_password, p_is_auto, 'active')
  returning id into v_new_user_id;

  update public.account_registration_requests
  set status = case when p_is_auto then 'auto_approved' else 'approved' end,
      processed_by_system = p_is_auto,
      processed_by_user_id = p_admin_user_id,
      processed_at = now(),
      resulting_user_id = v_new_user_id
  where id = p_request_id;

  return v_new_user_id;
end;
$$;

comment on function public.approve_account_registration_request is
  '계정 등록 요청 승인(자동/수동 공통). User 생성 + 요청 상태 갱신을 하나의 트랜잭션으로 처리. service role 전용.';

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
  -- 거부 시 자격증명은 즉시 폐기한다 (도메인 문서 2번: "거부 시... 자격증명은 폐기").
  update public.account_registration_requests
  set status = 'rejected',
      processed_by_system = false,
      processed_by_user_id = p_admin_user_id,
      processed_at = now(),
      encrypted_password = ''
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'request % not found or not pending', p_request_id;
  end if;
end;
$$;

comment on function public.reject_account_registration_request is
  '계정 등록 요청 거부. 암호화된 비밀번호 컬럼을 즉시 비워 자격증명을 폐기한다. service role 전용.';
