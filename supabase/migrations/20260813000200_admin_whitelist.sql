-- AdminWhitelist: 가입 즉시 자동으로 Admin 권한을 받는 사내 계정 ID 목록.
-- users 테이블보다 먼저 만들어져야 하는 정적 목록이므로 가장 먼저 생성한다.
-- (users.id를 참조하는 added_by_user_id는 users 테이블 생성 후 별도 마이그레이션에서 FK로 연결한다)

create table if not exists public.admin_whitelist (
  id uuid primary key default gen_random_uuid(),
  email_alias text not null unique,       -- 화이트리스트에 올라간 사내 계정 ID
  reason text,                            -- 등록 사유
  added_by_user_id uuid,                  -- 등록한 Admin (부트스트랩 최초 등록 시에는 NULL 허용 = 수동 시딩)
  created_at timestamptz not null default now()
);

comment on table public.admin_whitelist is
  'Admin 부트스트랩용 사전 등록 목록. 여기 있는 email_alias로 가입 신청하면 자동 승인 + Admin 권한 부여됨. Admin만 추가/제거 가능.';
