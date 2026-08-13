-- User (요청자): 온보딩(등록 웹페이지 신청 -> Admin 승인 또는 화이트리스트 자동승인)을
-- 마친 사용자만 이 테이블에 row로 존재한다 (도메인 문서 5번:
-- "한 User는 정확히 하나의 승인된 AccountRegistrationRequest로부터 생성된다").
-- 그래서 이 테이블에는 pending/rejected 상태가 없다 — 그 상태는
-- account_registration_requests 테이블이 담당한다. users.status는
-- "승인 이후" 생명주기(이용 가능 <-> 동의 철회)만 표현한다.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),

  -- 텔레그램 사용자ID: 딥링크(t.me/봇?start=토큰)로 확보한 위조 불가능한 값만 신뢰한다.
  telegram_user_id bigint not null unique,

  -- 사내 계정 식별자 (email_alias, 예: 사번/아이디)
  email_alias text not null unique,

  -- 사내 계정 비밀번호: 애플리케이션 레벨 AES 등으로 암호화된 결과(ciphertext)만 저장한다.
  -- 복호화 키는 이 DB와 분리된 환경변수/KMS에 보관하며 DB에는 절대 저장하지 않는다.
  -- 평문 비밀번호는 어떤 컬럼/로그에도 남기지 않는다.
  encrypted_password text not null,

  is_admin boolean not null default false,

  -- 승인 이후 생명주기: active(이용 가능) / revoked(동의 철회, 자격증명 폐기 요청)
  status text not null default 'active' check (status in ('active', 'revoked')),

  approved_at timestamptz not null default now(),  -- 등록 승인 일시
  revoked_at timestamptz,                          -- 동의 철회 일시 (해당 시에만 값 존재)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  '온보딩 승인을 마친 사용자. 텔레그램 사용자ID는 딥링크로 확보한 값만 신뢰(자기신고 금지).';
comment on column public.users.encrypted_password is
  '애플리케이션 레벨 AES로 암호화된 사내 계정 비밀번호. DB 자체 암호화 기능에 의존하지 않음. 평문 저장/로깅 금지.';

-- admin_whitelist.added_by_user_id -> users.id FK를 이제 연결한다.
alter table public.admin_whitelist
  add constraint admin_whitelist_added_by_user_id_fkey
  foreign key (added_by_user_id) references public.users(id) on delete set null;

-- updated_at 자동 갱신 트리거 (단순 유틸리티, 비즈니스 로직 아님)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();
