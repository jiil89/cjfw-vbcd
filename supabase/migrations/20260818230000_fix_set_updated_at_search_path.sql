-- 보안 어드바이저(Supabase Advisor, function_search_path_mutable) 수정.
--
-- [문제] set_updated_at()이 search_path를 고정하지 않았다. 다른 security definer
-- 함수들(approve_account_registration_request 등)은 전부 `set search_path = public`을
-- 명시하는데 이 트리거 함수만 빠져 있었다. search_path가 고정 안 된 함수는, 호출 세션의
-- search_path를 조작해 다른 스키마에 만든 동명 객체(예: now())가 대신 실행되게 하는
-- 공격에 이론상 노출된다.
--
-- [발견 경위] 실제 Supabase 프로젝트(DB-2)에 마이그레이션을 처음 적용한 뒤
-- `get_advisors(type: "security")`로 확인하다가 WARN으로 잡혔다. 로컬 Postgres에는
-- Supabase Advisor가 없어 지금까지 드러나지 않았다.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
