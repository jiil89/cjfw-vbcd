// reservation_requests 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스)
// → 애플리케이션 타입(camelCase) 변환은 이 계층에서만 한다.
//
// BE-6(예약 도구 계층)에서 필요한 만큼만 구현한다 — 예약 요청 생성/상태 갱신/단건 확정
// 참조 연결 정도. 분할 예약(긴 회의)은 이 테이블 1건에 reservations 여러 건이
// reservation_request_id로 역참조된다 (8-schema.sql 6번 주석 참고).

import { pool } from "../pool";

export type ReservationRequestStatus =
  | "received"
  | "availability_checked"
  | "confirmed"
  | "conflict"
  | "cancelled";

export interface ReservationRequest {
  id: string;
  userId: string;
  title: string;
  contents: string | null;
  desiredDate: string;
  desiredStartTime: string;
  desiredEndTime: string;
  status: ReservationRequestStatus;
  reservationId: string | null;
  createdAt: string;
}

interface ReservationRequestRow {
  id: string;
  user_id: string;
  title: string;
  contents: string | null;
  desired_date: string;
  desired_start_time: string;
  desired_end_time: string;
  status: ReservationRequestStatus;
  reservation_id: string | null;
  created_at: string;
}

const RESERVATION_REQUEST_COLUMNS =
  "id, user_id, title, contents, desired_date, desired_start_time, desired_end_time, status, reservation_id, created_at";

function toReservationRequest(row: ReservationRequestRow): ReservationRequest {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    contents: row.contents,
    desiredDate: row.desired_date,
    desiredStartTime: row.desired_start_time,
    desiredEndTime: row.desired_end_time,
    status: row.status,
    reservationId: row.reservation_id,
    createdAt: row.created_at,
  };
}

export interface CreateReservationRequestParams {
  userId: string;
  title: string;
  contents: string | null;
  desiredDate: string;
  desiredStartTime: string;
  desiredEndTime: string;
}

export async function createReservationRequest(
  params: CreateReservationRequestParams
): Promise<ReservationRequest> {
  const result = await pool.query<ReservationRequestRow>(
    `insert into public.reservation_requests
       (user_id, title, contents, desired_date, desired_start_time, desired_end_time, status)
     values ($1, $2, $3, $4, $5, $6, 'received')
     returning ${RESERVATION_REQUEST_COLUMNS}`,
    [
      params.userId,
      params.title,
      params.contents,
      params.desiredDate,
      params.desiredStartTime,
      params.desiredEndTime,
    ]
  );
  return toReservationRequest(result.rows[0]);
}

export async function setReservationRequestStatus(
  id: string,
  status: ReservationRequestStatus
): Promise<void> {
  await pool.query(`update public.reservation_requests set status = $2 where id = $1`, [id, status]);
}

/** 분할 없이 1건으로 끝난 요청에 한해 reservation_id 편의 컬럼을 채운다 (8-schema.sql 6번 주석). */
export async function linkReservationRequestToReservation(
  requestId: string,
  reservationId: string
): Promise<void> {
  await pool.query(
    `update public.reservation_requests set status = 'confirmed', reservation_id = $2 where id = $1`,
    [requestId, reservationId]
  );
}

export async function findReservationRequestById(id: string): Promise<ReservationRequest | null> {
  const result = await pool.query<ReservationRequestRow>(
    `select ${RESERVATION_REQUEST_COLUMNS} from public.reservation_requests where id = $1`,
    [id]
  );
  return result.rows[0] ? toReservationRequest(result.rows[0]) : null;
}
