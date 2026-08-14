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

/**
 * 회원가입 승인 시점에 신청 단계에서 골라둔 선호 회의실을 새 사용자에게 심는다.
 * 배열 순서를 우선순위(1이 최우선)로 그대로 반영한다. 존재하지 않는 room_id가 섞여 있으면
 * `user_preferred_rooms.room_id`의 FK 제약이 그 행에서 실패하므로, 호출 전에 room_id들이
 * 실제 `rooms`에 존재하는지 상위 계층(registrationService/adminService)이 이미 검증한 상태여야 한다.
 * roomIds가 빈 배열이면 아무것도 하지 않는다(신청 시 선호 회의실을 고르지 않은 경우).
 */
export async function setPreferredRooms(userId: string, roomIds: string[]): Promise<void> {
  if (roomIds.length === 0) {
    return;
  }
  const values = roomIds.map((_, index) => `($1, $${index + 2}, ${index + 1})`).join(", ");
  await pool.query(
    `insert into public.user_preferred_rooms (user_id, room_id, priority) values ${values}`,
    [userId, ...roomIds]
  );
}

/**
 * [FE-5 챗봇 선호 회의실 관리 기능, 20260814] 이미 등록된 회의실이면 조용히 무시한다
 * (on conflict do nothing) — 챗봇이 "이미 선호 목록에 있어요"를 별도로 안내할 필요 없이
 * 이 함수 호출 후 findPreferredRoomsByUserId로 현재 목록을 다시 읽어 그대로 보여주면 된다.
 */
export async function addPreferredRoom(userId: string, roomId: string): Promise<void> {
  await pool.query(
    `insert into public.user_preferred_rooms (user_id, room_id, priority)
     select $1, $2, coalesce(max(priority), 0) + 1
     from public.user_preferred_rooms where user_id = $1
     on conflict (user_id, room_id) do nothing`,
    [userId, roomId]
  );
}

/**
 * [FE-5 챗봇 선호 회의실 관리 기능, 20260814] 삭제 후 남은 행의 priority를 1..N으로
 * 다시 촘촘하게 채운다(순위에 구멍이 생기지 않게). `unique(user_id, priority)` 제약과
 * 동시에 부딪히지 않도록 먼저 음수로 옮겼다가 다시 채우는 2단계로 처리한다.
 */
export async function removePreferredRoomByRoomId(userId: string, roomId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from public.user_preferred_rooms where user_id = $1 and room_id = $2`,
      [userId, roomId]
    );
    await client.query(
      `update public.user_preferred_rooms set priority = -priority where user_id = $1`,
      [userId]
    );
    await client.query(
      `with ranked as (
         select id, row_number() over (order by -priority) as new_priority
         from public.user_preferred_rooms where user_id = $1
       )
       update public.user_preferred_rooms u
       set priority = ranked.new_priority
       from ranked
       where u.id = ranked.id`,
      [userId]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
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
