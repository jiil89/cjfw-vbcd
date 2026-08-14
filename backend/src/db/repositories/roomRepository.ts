// rooms 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스) →
// 애플리케이션 타입(camelCase) 변환은 이 계층에서만 한다.
//
// BE-5(회의실 마스터데이터 동기화)에 필요한 만큼만 구현한다 — CRUD 전체가 아니라
// room_code 기준 upsert와 목록 조회만.

import { pool } from "../pool";

export interface Room {
  id: string;
  site: string;
  areaCode: string;
  subAreaCode: string;
  roomCode: string;
  roomName: string;
  floorLabel: string | null;
  capacity: number | null;
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RoomRow {
  id: string;
  site: string;
  area_code: string;
  sub_area_code: string;
  room_code: string;
  room_name: string;
  floor_label: string | null;
  capacity: number | null;
  is_bookable: boolean;
  created_at: string;
  updated_at: string;
}

const ROOM_COLUMNS =
  "id, site, area_code, sub_area_code, room_code, room_name, floor_label, capacity, is_bookable, created_at, updated_at";

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    site: row.site,
    areaCode: row.area_code,
    subAreaCode: row.sub_area_code,
    roomCode: row.room_code,
    roomName: row.room_name,
    floorLabel: row.floor_label,
    capacity: row.capacity,
    isBookable: row.is_bookable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findAllRooms(): Promise<Room[]> {
  const result = await pool.query<RoomRow>(
    `select ${ROOM_COLUMNS} from public.rooms order by floor_label, room_name`
  );
  return result.rows.map(toRoom);
}

/** BE-6: 예약 가능한(is_bookable=true) 회의실만 조회한다 — 가용성 조회/예약 생성 후보 풀. */
export async function findBookableRooms(): Promise<Room[]> {
  const result = await pool.query<RoomRow>(
    `select ${ROOM_COLUMNS} from public.rooms where is_bookable = true order by floor_label, room_name`
  );
  return result.rows.map(toRoom);
}

export interface FindBookableRoomsFilter {
  minCapacity?: number;
  floorLabel?: string;
}

/** FE-2: `GET /rooms` 공개 조회용 — 인원수/층 조건으로 필터링한다(docs/swagger.json 참고). */
export async function findBookableRoomsFiltered(filter: FindBookableRoomsFilter): Promise<Room[]> {
  const conditions: string[] = ["is_bookable = true"];
  const values: unknown[] = [];

  if (filter.minCapacity != null) {
    values.push(filter.minCapacity);
    conditions.push(`capacity >= $${values.length}`);
  }
  if (filter.floorLabel != null) {
    values.push(filter.floorLabel);
    conditions.push(`floor_label = $${values.length}`);
  }

  const result = await pool.query<RoomRow>(
    `select ${ROOM_COLUMNS} from public.rooms where ${conditions.join(" and ")} order by floor_label, room_name`,
    values
  );
  return result.rows.map(toRoom);
}

/** BE-6: 이력 기반 추천(get_user_frequent_rooms)에서 얻은 room_id 목록으로 Room 상세를 조회한다.
 * 입력 순서를 그대로 보존해서 반환한다(추천 우선순위 유지). */
export async function findRoomsByIds(roomIds: string[]): Promise<Room[]> {
  if (roomIds.length === 0) {
    return [];
  }
  const result = await pool.query<RoomRow>(
    `select ${ROOM_COLUMNS} from public.rooms where id = any($1::uuid[])`,
    [roomIds]
  );
  const byId = new Map(result.rows.map((row) => [row.id, toRoom(row)]));
  return roomIds.map((id) => byId.get(id)).filter((room): room is Room => Boolean(room));
}

export async function findRoomById(roomId: string): Promise<Room | null> {
  const result = await pool.query<RoomRow>(`select ${ROOM_COLUMNS} from public.rooms where id = $1`, [
    roomId,
  ]);
  return result.rows[0] ? toRoom(result.rows[0]) : null;
}

export async function findRoomByRoomCode(roomCode: string): Promise<Room | null> {
  const result = await pool.query<RoomRow>(
    `select ${ROOM_COLUMNS} from public.rooms where room_code = $1`,
    [roomCode]
  );
  return result.rows[0] ? toRoom(result.rows[0]) : null;
}

export interface UpsertRoomParams {
  site: string;
  areaCode: string;
  subAreaCode: string;
  roomCode: string;
  roomName: string;
  floorLabel: string | null;
  capacity: number | null;
}

/**
 * room_code 기준 upsert. 기존 값과 실제로 다른 컬럼이 하나라도 있을 때만 UPDATE되도록
 * `where ... is distinct from ...` 조건을 둔다(BE-5 완료조건: 멱등적 upsert). 조건이
 * 거짓이면(변경 없음) 이 conflict 대상 행은 전혀 건드려지지 않으므로 `updated_at`도
 * 갱신되지 않고, RETURNING 결과에도 포함되지 않는다.
 *
 * @returns 실제로 INSERT되었거나 UPDATE된 경우 true, 기존 값과 동일해 변경이 없었으면 false.
 */
export async function upsertRoomIfChanged(params: UpsertRoomParams): Promise<boolean> {
  const result = await pool.query(
    `insert into public.rooms
       (site, area_code, sub_area_code, room_code, room_name, floor_label, capacity, is_bookable)
     values ($1, $2, $3, $4, $5, $6, $7, true)
     on conflict (room_code) do update set
       area_code = excluded.area_code,
       sub_area_code = excluded.sub_area_code,
       room_name = excluded.room_name,
       floor_label = excluded.floor_label,
       capacity = excluded.capacity,
       is_bookable = true,
       updated_at = now()
     where public.rooms.area_code is distinct from excluded.area_code
        or public.rooms.sub_area_code is distinct from excluded.sub_area_code
        or public.rooms.room_name is distinct from excluded.room_name
        or public.rooms.floor_label is distinct from excluded.floor_label
        or public.rooms.capacity is distinct from excluded.capacity
        or public.rooms.is_bookable is distinct from true
     returning id`,
    [
      params.site,
      params.areaCode,
      params.subAreaCode,
      params.roomCode,
      params.roomName,
      params.floorLabel,
      params.capacity,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}
