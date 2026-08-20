-- 웹 회원가입/로그인 지원.
--
-- 1차 채널이 텔레그램에서 웹 챗봇으로 바뀌면서, 신원 확인 방식도 텔레그램 딥링크에서
-- 자체 회원가입/로그인(JWT)으로 바뀌었다 (docs/4-prd.md "인증/보안" 참고).
-- 그래서:
--   1) users / account_registration_requests에 "앱 로그인 비밀번호 해시" 컬럼을 추가한다.
--      사내 계정 비밀번호(encrypted_password, 복호화 가능한 암호화)와는 완전히 다른 값이며,
--      이건 로그인 검증에만 쓰이므로 bcrypt/argon2 같은 단방향 해시로 저장한다(복호화 불필요/불가능).
--   2) 텔레그램 관련 컬럼(telegram_user_id, telegram_deeplink_token)은 더 이상 회원가입 시점에
--      채워지지 않으므로 NOT NULL 제약을 없앤다 (텔레그램 채널을 나중에 추가하면 그때 채워짐).

alter table public.account_registration_requests
  add column if not exists app_password_hash text;

alter table public.account_registration_requests
  alter column telegram_deeplink_token drop not null;

alter table public.users
  add column if not exists app_password_hash text;

alter table public.users
  alter column telegram_user_id drop not null;

-- 앱 로그인 비밀번호 해시는 승인 완료(users row 생성) 이후부터는 필수여야 한다.
-- (등록 요청 단계에서는 아직 NULL일 수 없게 서버 코드가 항상 채우지만, DB 레벨에서도
--  users 테이블만큼은 강제한다 — 로그인 대상 테이블이라 더 엄격하게 지킨다.)
alter table public.users
  alter column app_password_hash set not null;

comment on column public.users.app_password_hash is
  '이 서비스 자체 로그인용 비밀번호 해시(bcrypt/argon2 등 단방향). 사내 계정 비밀번호(encrypted_password, 복호화 가능)와 혼동 금지.';
comment on column public.account_registration_requests.app_password_hash is
  '회원가입 시 설정한 앱 로그인 비밀번호 해시. 승인 시 users.app_password_hash로 복사된다.';

-- 승인 함수 재정의: 텔레그램 연동 완료를 더 이상 승인 전제조건으로 요구하지 않고,
-- app_password_hash를 users로 복사하도록 변경.
create or replace function public.approve_account_registration_request(
  p_request_id uuid,
  p_is_auto boolean,
  p_admin_user_id uuid default null
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

  if v_request.app_password_hash is null then
    raise exception 'request % has no app_password_hash set', p_request_id;
  end if;

  if not p_is_auto and p_admin_user_id is null then
    raise exception 'manual approval requires p_admin_user_id';
  end if;

  insert into public.users (telegram_user_id, email_alias, encrypted_password, app_password_hash, is_admin, status)
  values (v_request.telegram_user_id, v_request.email_alias, v_request.encrypted_password, v_request.app_password_hash, p_is_auto, 'active')
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

-- 거부 시 앱 로그인 비밀번호 해시도 함께 폐기한다 (사내 계정 비밀번호와 동일한 원칙).
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
