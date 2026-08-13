-- 보안 결함 수정: anon key로 Admin 권한을 탈취할 수 있는 문제.
--
-- [문제] approve_account_registration_request / reject_account_registration_request /
-- get_user_frequent_rooms는 security definer 함수인데, 지금까지 REVOKE EXECUTE가 없었다.
-- Postgres는 함수 EXECUTE 권한을 기본적으로 PUBLIC에 부여하고, Supabase는 public 스키마를
-- PostgREST RPC로 그대로 노출하므로, 지금까지는 anon key만 있으면 누구나
-- /rest/v1/rpc/approve_account_registration_request를 직접 호출할 수 있었다.
--
-- 게다가 approve_account_registration_request는 호출자가 넘긴 p_is_auto 값을 그대로 믿고
-- is_admin에 반영했다. 즉 anon이 등록 신청을 하나 만든 뒤(신청 자체는 원래도 공개 API였다)
-- p_is_auto=true로 직접 RPC를 호출하면, 화이트리스트 여부와 무관하게 Admin 계정이
-- 즉시 만들어졌다.
--
-- [수정]
--   1) 세 함수 모두 public/anon/authenticated의 EXECUTE 권한을 회수한다.
--      (service_role은 이 REVOKE 대상에 포함하지 않으므로, 신뢰된 백엔드는 계속 호출 가능)
--   2) approve_account_registration_request는 p_is_auto 파라미터를 아예 없애고,
--      함수 내부에서 admin_whitelist를 직접 재조회해 자동승인 여부를 스스로 판단한다.
--      화이트리스트 밖이라 수동 승인이 필요한 경우, p_admin_user_id가 실제로
--      is_admin=true / status='active'인 사용자인지도 DB가 직접 검증한다
--      (서버 코드의 JWT+is_admin 검사에만 의존하지 않는 이중 방어).
--   3) reject_account_registration_request도 동일하게 p_admin_user_id를 검증한다.

revoke execute on function public.approve_account_registration_request(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.reject_account_registration_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_user_frequent_rooms(uuid, int) from public, anon, authenticated;

-- 기존 시그니처(p_is_auto 포함)는 더 이상 쓰지 않으므로 삭제하고 새 시그니처로 다시 만든다.
drop function if exists public.approve_account_registration_request(uuid, boolean, uuid);

create function public.approve_account_registration_request(
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
    -- 호출자가 실제로 활성 Admin인지 DB가 직접 검증한다.
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
   수동 승인 시 p_admin_user_id가 실제 활성 Admin인지 DB가 검증한다. service_role 전용(REVOKE 적용됨).';

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
  '계정 등록 요청 거부. 암호화된 비밀번호/앱 로그인 비밀번호 해시를 즉시 폐기한다.
   p_admin_user_id가 실제 활성 Admin인지 DB가 검증한다. service_role 전용(REVOKE 적용됨).';

-- 새 시그니처에도 REVOKE를 다시 적용한다 (DROP 후 CREATE로 시그니처가 바뀌었으므로
-- 위쪽의 REVOKE는 이제 존재하지 않는 옛 시그니처를 대상으로 한 것이었다).
revoke execute on function public.approve_account_registration_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reject_account_registration_request(uuid, uuid) from public, anon, authenticated;
