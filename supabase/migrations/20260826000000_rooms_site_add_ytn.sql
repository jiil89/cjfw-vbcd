-- 2번째 사업장(YTN 본사) 지원 추가. 도메인 정의서 6번 "[결정됨]" 갱신에 대응.
-- 기존 CHECK 제약은 site='상암S시티' 단일 값만 허용했다 — 두 값(상암S시티/YTN 본사)을
-- 허용하도록 확장한다. 기존 상암S시티 회의실 26개는 그대로 유지(추가만, 삭제 없음).

alter table public.rooms drop constraint rooms_site_check;
alter table public.rooms add constraint rooms_site_check check (site in ('상암S시티', 'YTN 본사'));

-- site 컬럼의 default는 여전히 '상암S시티'로 둔다 — upsertRoomIfChanged가 항상 site를
-- 명시적으로 넘기므로 실질적 영향은 없지만, 기존 값을 임의로 바꿀 이유가 없다.
