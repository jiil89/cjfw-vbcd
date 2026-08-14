-- Admin 부트스트랩 시딩: 최초 Admin은 jiil(사내 계정 ID)로 확정.
-- admin_whitelist가 비어 있으면 아무도 Admin이 될 수 없는(닭과 달걀) 문제를 풀기 위한
-- 정적 시드 데이터. email_alias가 이미 있으면 건드리지 않는다(재실행 안전).
insert into public.admin_whitelist (email_alias, reason)
values ('jiil', '최초 Admin 부트스트랩 계정')
on conflict (email_alias) do nothing;
