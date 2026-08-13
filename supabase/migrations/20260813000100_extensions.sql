-- 필요한 Postgres 확장 기능

-- pgcrypto: gen_random_uuid() 로 UUID PK를 생성하기 위해 사용.
--   비밀번호 자체의 암호화/복호화는 DB가 아니라 애플리케이션 레벨 AES에서 수행한다.
--   (Supabase/Postgres 자체 암호화 기능에는 의존하지 않는다는 원칙)
create extension if not exists pgcrypto;

-- btree_gist: reservations 테이블에서 "같은 회의실 + 겹치는 시간대" 중복 예약을
--   DB 레벨에서 원천 차단하는 EXCLUDE 제약조건에 필요.
--   (uuid 컬럼을 gist 인덱스에서 등치(=) 비교하려면 btree_gist가 있어야 함)
create extension if not exists btree_gist;
