-- Refresh Token 발급 이력 테이블.
--
-- [배경] docs/4-prd.md "인증/보안": Access Token(짧은 만료, 응답 바디) + Refresh Token
-- (httpOnly Secure SameSite 쿠키) 방식. Refresh Token은 서버가 개별/전체 폐기(revoke)할 수
-- 있어야 하므로, "발급 이력을 DB에 남긴다"는 원칙(docs/5-project-principle.md 5번)에 따라
-- 이 테이블을 추가한다.
--
-- [평문을 저장하지 않는 이유] 이 프로젝트는 사내 계정 비밀번호/앱 로그인 비밀번호 등 어떤
-- 비밀정보도 평문으로 DB에 남기지 않는다는 원칙을 일관되게 지킨다. Refresh Token도 탈취 시
-- 로그인을 대체할 수 있는 비밀정보이므로, 토큰 원문이 아니라 그 해시값만 저장한다
-- (예: SHA-256). DB가 유출되더라도 저장된 값만으로는 토큰을 재구성할 수 없다.
--
-- [폐기(revoke) 시나리오]
--   1) 개별 로그아웃: 해당 토큰 한 건만 `revoked=true, revoked_at=now()`로 UPDATE.
--   2) 전체 폐기(비밀번호 변경/보안사고 대응): 해당 user_id의 아직 폐기 안 된
--      (revoked=false) 토큰 전체를 한 번의 UPDATE로 처리 가능. 별도 함수/RPC 없이
--      단순 UPDATE ... WHERE user_id = $1 AND revoked = false 로 충분하므로
--      (user_id, revoked) 인덱스만 둔다.
--
-- [스코프 밖] 만료된 토큰을 주기적으로 정리(삭제)하는 배치/크론 작업은 이번 스코프가 아니다.
-- 필요해지면 나중에 별도 태스크로 추가한다 (오버엔지니어링 금지 원칙).

create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- Refresh Token 원문이 아니라 해시값만 저장 (예: SHA-256). 평문 토큰은 어디에도 남기지 않는다.
  token_hash text not null unique,

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,

  revoked boolean not null default false,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint refresh_tokens_revoked_at_consistency check (
    (revoked = false and revoked_at is null)
    or (revoked = true and revoked_at is not null)
  )
);

-- 로그인 시점에 "이 사용자의 유효한(폐기 안 된) 토큰"을 조회/전체 폐기하는 쿼리를 위한 인덱스.
create index if not exists refresh_tokens_user_id_revoked_idx
  on public.refresh_tokens (user_id, revoked);

comment on table public.refresh_tokens is
  'Refresh Token 발급 이력. 토큰 원문이 아니라 해시값만 저장한다. 개별 로그아웃 시 해당 행 하나를,
   비밀번호 변경/보안사고 대응 시 해당 user_id의 폐기 안 된 행 전체를 UPDATE로 폐기 처리한다.';
comment on column public.refresh_tokens.token_hash is
  'Refresh Token 원문의 해시값(예: SHA-256). 평문 토큰은 DB에 저장하지 않는다.';

alter table public.refresh_tokens enable row level security;

-- anon/authenticated용 정책을 전혀 만들지 않는다. RLS가 켜져 있고 정책이 없으면 기본값은
-- "모두 거부"이므로, 이 테이블은 service role key를 쓰는 신뢰된 백엔드만 접근 가능하다
-- (이 파일 상단 9번 섹션 "RLS 정책" 절의 아키텍처 전제와 동일한 근거).
