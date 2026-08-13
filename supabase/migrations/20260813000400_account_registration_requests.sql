-- AccountRegistrationRequest (계정 등록 요청)
-- 등록 웹페이지에서 제출한 사내 계정 등록/텔레그램 연동 신청 건.

create table if not exists public.account_registration_requests (
  id uuid primary key default gen_random_uuid(),

  email_alias text not null,                  -- 신청한 사내 계정 ID
  encrypted_password text not null,            -- 애플리케이션 레벨 AES로 암호화된 비밀번호

  -- 텔레그램 딥링크(t.me/봇?start=토큰) 연동용 1회성 토큰.
  -- 사용자가 딥링크를 클릭하면 봇 백엔드가 telegram_user_id를 채워 넣는다.
  telegram_deeplink_token text not null unique,
  telegram_user_id bigint,                     -- 딥링크 클릭 전에는 NULL

  status text not null default 'pending'
    check (status in ('pending', 'auto_approved', 'approved', 'rejected')),

  -- 처리한 Admin. 화이트리스트 자동승인인 경우 NULL + processed_by_system = true 로 표시한다
  -- ("system"이 처리했다는 의미를 문자열로 흉내내지 않고 명시적 플래그로 표현).
  processed_by_user_id uuid references public.users(id) on delete set null,
  processed_by_system boolean not null default false,
  processed_at timestamptz,

  -- 승인 완료 시 생성된 User row와 연결 (감사 추적용)
  resulting_user_id uuid references public.users(id) on delete set null,

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
  '등록 웹페이지 신청 건. 화이트리스트 매칭 시 auto_approved, 아니면 pending 상태로 Admin 승인 대기.';
comment on column public.account_registration_requests.encrypted_password is
  '애플리케이션 레벨 AES로 암호화된 비밀번호. 승인 시 users.encrypted_password로 복사된다. 평문 저장/로깅 금지.';
