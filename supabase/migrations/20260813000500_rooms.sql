-- Room (회의실): 사업장(Site) -> 층(Floor) -> 회의실(Room) 3단계 계층 중
-- 실제 예약 최소 단위. 1차 범위는 상암S시티로 고정.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),

  -- 1차 범위는 상암S시티 단일 사업장으로 고정 (도메인 문서 6번).
  -- 값이 하나뿐이므로 별도 enum/테이블 없이 텍스트 + check로 충분 (오버엔지니어링 방지).
  site text not null default '상암S시티' check (site = '상암S시티'),

  area_code text not null,        -- 건물 코드 (CJ 시스템 값, 예: 'XXX')
  sub_area_code text not null,    -- 층 코드 (CJ 시스템 값, 예: 'XXXX')
  room_code text not null unique, -- 회의실 코드 (CJ 시스템 값, 예: 'XXXX') - 예약 API의 실제 식별자

  room_name text not null,        -- 회의실 이름 (예: '3F-1', '12F-3')
  floor_label text,               -- 층 표기 (예: '3F', '12F') - 사람이 읽기 편한 참고용
  capacity int,                   -- 수용 인원

  -- B1F/2F 등 실사용 회의실이 아닌 층은 데이터를 아예 넣지 않거나(권장),
  -- 이미 들어간 경우를 대비해 false로 예약 후보 풀에서 제외할 수 있는 안전장치.
  is_bookable boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (area_code, sub_area_code, room_code)
);

create index if not exists rooms_is_bookable_idx on public.rooms (is_bookable);

comment on table public.rooms is
  '예약 가능한 회의실 목록 (상암S시티 3F, 12F~16F). B1F/2F는 넣지 않거나 is_bookable=false로 제외.';

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row
  execute function public.set_updated_at();
