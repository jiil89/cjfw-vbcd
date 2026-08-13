// user_preferred_rooms 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스)
// → 애플리케이션 타입(camelCase) 변환은 이 계층에서만 한다.
//
// rooms와 조인해서 바로 Room 정보를 우선순위 순으로 돌려준다 — 도구 계층이 room_id만
// 들고 다시 조회하는 왕복을 줄인다.

import { pool } from "../pool";
import type { Room } from "./roomRepository";

interface PreferredRoomRow {
  priority: number;
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

function toRoom(row: PreferredRoomRow): Room {
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

/** 사용자가 가입 시 등록한 선호 회의실을 우선순위(1이 최우선) 순서로 반환한다. */
export async function findPreferredRoomsByUserId(userId: string): Promise<Room[]> {
  const result = await pool.query<PreferredRoomRow>(
    `select upr.priority,
            r.id, r.site, r.area_code, r.sub_area_code, r.room_code, r.room_name,
            r.floor_label, r.capacity, r.is_bookable, r.created_at, r.updated_at
     from public.user_preferred_rooms upr
     join public.rooms r on r.id = upr.room_id
     where upr.user_id = $1
     order by upr.priority asc`,
    [userId]
  );
  return result.rows.map(toRoom);
}
