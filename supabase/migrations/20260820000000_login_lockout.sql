-- 로그인 브루트포스 방어: 앱 로그인 비밀번호를 5회 연속 틀리면 계정을 잠그고,
-- Admin이 승인 패널에서 직접 잠금을 해제해야 다시 로그인할 수 있게 한다.
--
-- [배경] 지금까지는 사내망 안에서만 접속 가능하다는 것 자체가 실질적 방어막이었다.
-- Cloudflare Tunnel로 외부 접속을 허용하기로 하면서 그 방어막이 사라지는데, 로그인에는
-- 시도 횟수 제한이 전혀 없었다. email_alias는 비밀값이 아니라 사번이라 유추 가능하므로,
-- 이제는 무작정 대입(brute force) 공격에 실질적으로 노출된다.
--
-- 잠금 해제를 자동화(자가 재설정)하지 않고 Admin 대행으로만 여는 이유는 비밀번호
-- 자가 재설정을 지원하지 않는 것과 같은 이유다(도메인 정의서 "비밀번호 변경" 절 참고) —
-- 메일 발송 수단이 없어 본인 확인을 할 방법이 없다. Admin 승인 패널에 이미 "확인하고
-- 처리한다"는 흐름이 있으므로(등록 요청 승인/거부와 동일 패턴), 잠긴 계정 목록도
-- 그 자리에 그대로 노출해 Admin이 확인 후 해제하게 한다 — 별도의 "해제 요청" 엔티티를
-- 새로 만들지 않는다(오버엔지니어링 방지, 등록 요청과 동일한 "Admin이 보고 처리" 모델 재사용).

alter table public.users
  add column if not exists failed_login_attempts smallint not null default 0;

alter table public.users drop constraint if exists users_status_check;
alter table public.users
  add constraint users_status_check check (status in ('active', 'revoked', 'locked'));

comment on column public.users.failed_login_attempts is
  '연속 로그인 실패 횟수. 5회(MAX_LOGIN_ATTEMPTS) 도달 시 status가 locked로 바뀌고 로그인이
   거부된다. 로그인 성공 또는 Admin의 잠금 해제 시 0으로 리셋된다.';
