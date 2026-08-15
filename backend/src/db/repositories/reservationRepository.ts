// reservations 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스)
// → 애플리케이션 타입(camelCase) 변환은 이 계층에서만 한다.
//
// `reservations_no_overlap` EXCLUDE 제약(8-schema.sql) 위반 시 Postgres는 SQLSTATE
// 23P01(exclusion_violation)을 던진다. 이 리포지토리가 그 에러를 잡아 도구 계층이
// "이미 예약됨" 사용자 메시지로 바로 옮길 수 있는 전용 에러 타입(RoomAlreadyBookedError)으로
// 변환한다 (BE-6 완료조건).

import type { PoolClient } from "pg";
import { pool } from "../pool";

export type ReservationStatus = "confirmed" | "modified" | "cancelled";

export interface Reservation {
  id: string;
  reservationRequestId: string | null;
  userId: string;
  roomId: string;
  cjSeq: string | null;
  title: string;
  contents: string | null;
  startAt: string;
  endAt: string;
  status: ReservationStatus;
  createdAt: string;
  updatedAt: string;
}

interface ReservationRow {
  id: string;
  reservation_request_id: string | null;
  user_id: string;
  room_id: string;
  cj_seq: string | null;
  title: string;
  contents: string | null;
  // timestamptz 컬럼 — node-postgres가 실제로는 Date 객체를 돌려준다(위 toIsoString 주석 참고).
  start_at: string | Date;
  end_at: string | Date;
  status: ReservationStatus;
  created_at: string | Date;
  updated_at: string | Date;
}

const RESERVATION_COLUMNS =
  "id, reservation_request_id, user_id, room_id, cj_seq, title, contents, start_at, end_at, status, created_at, updated_at";

// [2026-08-14 실사용 검증 완료 — 예약 변경/취소가 항상 "시스템 오류"로 실패하던 버그]
// start_at/end_at 컬럼은 timestamptz라 node-postgres가 기본적으로 JS Date 객체로 파싱해
// 돌려준다 — 이 파일의 타입(ReservationRow.start_at: string)은 실제로는 거짓이었다.
// HTTP 응답으로 나갈 때는 JSON.stringify가 Date를 ISO 문자열로 자동 변환해줘서 문제가
// 안 드러났지만, reservationTargeting.ts의 hintMatches()처럼 백엔드 안에서 이 값에 직접
// `.slice(11, 16)`을 호출하는 코드는 `TypeError: startAt.slice is not a function`으로
// 죽었다(예약 변경/취소가 항상 "시스템 오류가 발생했어요"로만 실패하는 원인이었음). DB
// 컬럼 → 애플리케이션 타입 변환은 이 리포지토리 계층에서만 한다는 원칙(5-project-principle.md
// §3)대로, 여기서 항상 실제 문자열로 정규화해 타입 선언이 거짓말이 아니게 만든다.
function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    reservationRequestId: row.reservation_request_id,
    userId: row.user_id,
    roomId: row.room_id,
    cjSeq: row.cj_seq,
    title: row.title,
    contents: row.contents,
    startAt: toIsoString(row.start_at),
    endAt: toIsoString(row.end_at),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/** `reservations_no_overlap` EXCLUDE 제약 위반(Postgres SQLSTATE 23P01)을 도구 계층이
 * "이미 예약됨" 메시지로 바로 변환할 수 있도록 감싼 전용 에러. */
export class RoomAlreadyBookedError extends Error {
  constructor(message = "선택한 회의실/시간대는 이미 예약되어 있습니다.") {
    super(message);
    this.name = "RoomAlreadyBookedError";
  }
}

function isExclusionViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23P01"
  );
}

export interface CreateReservationParams {
  reservationRequestId: string | null;
  userId: string;
  roomId: string;
  cjSeq: string;
  title: string;
  contents: string | null;
  startAt: string;
  endAt: string;
}

/**
 * 확정 예약 1건을 DB에 기록한다. CJ 시스템에는 이미 SaveReserve로 생성된 이후 호출하는
 * 것을 전제로 한다(cjSeq 필수) — CJ 자동화 계층은 예약 비즈니스 규칙을 모르므로, 이
 * 함수는 순수하게 "CJ에서 이미 확정된 예약을 로컬에 기록"만 담당한다.
 *
 * DB 자체의 reservations_no_overlap EXCLUDE 제약에 걸리면(같은 회의실+겹치는 시간대가
 * 이미 있으면) RoomAlreadyBookedError로 변환해 던진다 — 호출자(reservation.tool)는 이
 * 경우 CJ 쪽에 이미 만들어진 예약을 delReserve로 보상 취소해야 한다.
 */
export async function createReservation(
  params: CreateReservationParams,
  client: PoolClient | typeof pool = pool
): Promise<Reservation> {
  try {
    const result = await client.query<ReservationRow>(
      `insert into public.reservations
         (reservation_request_id, user_id, room_id, cj_seq, title, contents, start_at, end_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed')
       returning ${RESERVATION_COLUMNS}`,
      [
        params.reservationRequestId,
        params.userId,
        params.roomId,
        params.cjSeq,
        params.title,
        params.contents,
        params.startAt,
        params.endAt,
      ]
    );
    return toReservation(result.rows[0]);
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new RoomAlreadyBookedError();
    }
    throw err;
  }
}

export async function findReservationById(id: string): Promise<Reservation | null> {
  const result = await pool.query<ReservationRow>(
    `select ${RESERVATION_COLUMNS} from public.reservations where id = $1`,
    [id]
  );
  return result.rows[0] ? toReservation(result.rows[0]) : null;
}

/** 같은 reservation_request_id를 공유하는 예약 전체 (긴 회의 분할 그룹). */
export async function findReservationsByRequestId(requestId: string): Promise<Reservation[]> {
  const result = await pool.query<ReservationRow>(
    `select ${RESERVATION_COLUMNS} from public.reservations
     where reservation_request_id = $1
     order by start_at asc`,
    [requestId]
  );
  return result.rows.map(toReservation);
}

/** 취소되지 않은, 특정 사용자의 특정 기간(겹치는) 예약 목록. 내 예약 조회/변경·취소 대상 특정에 사용. */
export async function cancelReservationById(id: string): Promise<void> {
  await pool.query(`update public.reservations set status = 'cancelled' where id = $1`, [id]);
}

export interface ReservationWithRoom extends Reservation {
  roomName: string;
  roomCode: string;
  floorLabel: string | null;
}

interface ReservationWithRoomRow extends ReservationRow {
  room_name: string;
  room_code: string;
  floor_label: string | null;
}

function toReservationWithRoom(row: ReservationWithRoomRow): ReservationWithRoom {
  return {
    ...toReservation(row),
    roomName: row.room_name,
    roomCode: row.room_code,
    floorLabel: row.floor_label,
  };
}

/** 변경/취소 대상을 사용자에게 보여주기 위해 room_name 등을 조인해서 함께 반환한다
 * (modifyReservation/cancelReservation 도구가 후보 목록을 안내할 때 사용). */
export async function findActiveReservationsWithRoomByUserAndRange(
  userId: string,
  rangeStartAt: string,
  rangeEndAt: string
): Promise<ReservationWithRoom[]> {
  const result = await pool.query<ReservationWithRoomRow>(
    `select ${RESERVATION_COLUMNS.split(", ")
      .map((col) => `res.${col}`)
      .join(", ")},
            room.room_name, room.room_code, room.floor_label
     from public.reservations res
     join public.rooms room on room.id = res.room_id
     where res.user_id = $1
       and res.status <> 'cancelled'
       and res.start_at < $3
       and res.end_at > $2
     order by res.start_at asc`,
    [userId, rangeStartAt, rangeEndAt]
  );
  return result.rows.map(toReservationWithRoom);
}

export async function markReservationModified(
  id: string,
  params: { roomId?: string; startAt?: string; endAt?: string; cjSeq?: string }
): Promise<Reservation | null> {
  try {
    const result = await pool.query<ReservationRow>(
      `update public.reservations
       set status = 'modified',
           room_id = coalesce($2, room_id),
           start_at = coalesce($3, start_at),
           end_at = coalesce($4, end_at),
           cj_seq = coalesce($5, cj_seq)
       where id = $1
       returning ${RESERVATION_COLUMNS}`,
      [id, params.roomId ?? null, params.startAt ?? null, params.endAt ?? null, params.cjSeq ?? null]
    );
    return result.rows[0] ? toReservation(result.rows[0]) : null;
  } catch (err) {
    if (isExclusionViolation(err)) {
      throw new RoomAlreadyBookedError();
    }
    throw err;
  }
}

/** 사용자의 취소되지 않은 예약을 회의실별로 집계해 예약 횟수가 많은 순으로 반환한다
 * (get_user_frequent_rooms RPC, 8-schema.sql 8번 — 이력 기반 추천에 사용). */
export async function findFrequentRoomIdsByUserId(
  userId: string,
  limit = 3
): Promise<Array<{ roomId: string; reservationCount: number }>> {
  const result = await pool.query<{ room_id: string; reservation_count: string }>(
    `select room_id, reservation_count from public.get_user_frequent_rooms($1, $2)`,
    [userId, limit]
  );
  return result.rows.map((row) => ({
    roomId: row.room_id,
    reservationCount: Number(row.reservation_count),
  }));
}
