// account_registration_requests / admin_whitelist 리포지토리.
// 5-project-principle.md §3: 컬럼(스네이크케이스) → 애플리케이션 타입(camelCase) 변환은
// 이 계층에서만 한다.

import { pool } from "../pool";

export type RegistrationRequestStatus = "pending" | "auto_approved" | "approved" | "rejected";

export interface RegistrationRequest {
  id: string;
  emailAlias: string;
  status: RegistrationRequestStatus;
  processedByUserId: string | null;
  /** FE-4: 처리자 표시용(와이어프레임 "처리자: hong.gd"). 자동승인이면 null(프론트가 "system"으로 표시). */
  processedByEmailAlias: string | null;
  processedBySystem: boolean;
  processedAt: string | null;
  resultingUserId: string | null;
  preferredRoomIds: string[];
  createdAt: string;
}

interface RegistrationRequestRow {
  id: string;
  email_alias: string;
  status: RegistrationRequestStatus;
  processed_by_user_id: string | null;
  processed_by_email_alias: string | null;
  processed_by_system: boolean;
  processed_at: string | null;
  resulting_user_id: string | null;
  preferred_room_ids: string[];
  created_at: string;
}

// INSERT ... RETURNING 등 별칭(alias) 없는 단순 쿼리용 — processed_by_email_alias는
// 아직 처리 전(pending 신규 생성)이라 항상 null이다.
const REGISTRATION_REQUEST_COLUMNS =
  "id, email_alias, status, processed_by_user_id, processed_by_system, processed_at, resulting_user_id, preferred_room_ids, created_at, null as processed_by_email_alias";

// FE-4: 처리자 이름(email_alias) 표시를 위해 users와 LEFT JOIN하는 조회용.
// `from public.account_registration_requests arr left join public.users admin_u on ...`와 함께 쓴다.
const REGISTRATION_REQUEST_COLUMNS_WITH_PROCESSOR =
  "arr.id, arr.email_alias, arr.status, arr.processed_by_user_id, admin_u.email_alias as processed_by_email_alias, arr.processed_by_system, arr.processed_at, arr.resulting_user_id, arr.preferred_room_ids, arr.created_at";

function toRegistrationRequest(row: RegistrationRequestRow): RegistrationRequest {
  return {
    id: row.id,
    emailAlias: row.email_alias,
    status: row.status,
    processedByUserId: row.processed_by_user_id,
    processedByEmailAlias: row.processed_by_email_alias ?? null,
    processedBySystem: row.processed_by_system,
    processedAt: row.processed_at,
    resultingUserId: row.resulting_user_id,
    preferredRoomIds: row.preferred_room_ids,
    createdAt: row.created_at,
  };
}

/**
 * email_alias 중복 여부를 최소한으로만 확인한다: 이미 승인된 사용자(users)이거나
 * 아직 처리되지 않은 신청(pending)이 있으면 true.
 */
export async function isEmailAliasTaken(emailAlias: string): Promise<boolean> {
  const result = await pool.query(
    `select 1
     from public.users
     where email_alias = $1
     union all
     select 1
     from public.account_registration_requests
     where email_alias = $1 and status = 'pending'
     limit 1`,
    [emailAlias]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function isEmailAliasWhitelisted(emailAlias: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from public.admin_whitelist where email_alias = $1 limit 1`,
    [emailAlias]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertPendingRegistrationRequest(params: {
  emailAlias: string;
  encryptedPassword: string;
  appPasswordHash: string;
  preferredRoomIds: string[];
}): Promise<RegistrationRequest> {
  const result = await pool.query<RegistrationRequestRow>(
    `insert into public.account_registration_requests
       (email_alias, encrypted_password, app_password_hash, preferred_room_ids, status)
     values ($1, $2, $3, $4, 'pending')
     returning ${REGISTRATION_REQUEST_COLUMNS}`,
    [params.emailAlias, params.encryptedPassword, params.appPasswordHash, params.preferredRoomIds]
  );
  return toRegistrationRequest(result.rows[0]);
}

/**
 * 로그인 실패 사유(승인 대기/거부)를 구분해 안내하기 위해, 아직 users에 없는
 * email_alias의 가장 최근 신청 건을 조회한다.
 */
export async function findLatestRegistrationRequestByEmailAlias(
  emailAlias: string
): Promise<RegistrationRequest | null> {
  const result = await pool.query<RegistrationRequestRow>(
    `select ${REGISTRATION_REQUEST_COLUMNS}
     from public.account_registration_requests
     where email_alias = $1
     order by created_at desc
     limit 1`,
    [emailAlias]
  );
  return result.rows[0] ? toRegistrationRequest(result.rows[0]) : null;
}

export async function findRegistrationRequestById(
  requestId: string
): Promise<RegistrationRequest | null> {
  const result = await pool.query<RegistrationRequestRow>(
    `select ${REGISTRATION_REQUEST_COLUMNS_WITH_PROCESSOR}
     from public.account_registration_requests arr
     left join public.users admin_u on admin_u.id = arr.processed_by_user_id
     where arr.id = $1`,
    [requestId]
  );
  return result.rows[0] ? toRegistrationRequest(result.rows[0]) : null;
}

/**
 * BE-3/FE-4: Admin 승인 패널용 — 상태별 목록을 조회한다. `docs/swagger.json`의
 * `GET /admin/registration-requests?status=` 계약과 동일하게, pending은 신청 오래된
 * 순(먼저 접수된 것부터 처리하도록), 처리 완료 상태(auto_approved/approved/rejected)는
 * 최근 처리분이 먼저 보이도록 최신 처리 시각 순으로 정렬한다. 비밀번호/암호문 컬럼은
 * 애초에 SELECT하지 않으므로 응답에 절대 포함되지 않는다.
 *
 * @param limit 처리 완료 이력이 무한정 쌓이는 것을 막기 위한 상한(pending 조회 시엔 무시).
 */
export async function findRegistrationRequestsByStatuses(
  statuses: RegistrationRequestStatus[],
  limit = 50
): Promise<RegistrationRequest[]> {
  const isPendingOnly = statuses.length === 1 && statuses[0] === "pending";
  const orderClause = isPendingOnly ? "arr.created_at asc" : "arr.processed_at desc nulls last";
  const limitClause = isPendingOnly ? "" : "limit $2";
  const values: unknown[] = isPendingOnly ? [statuses] : [statuses, limit];

  const result = await pool.query<RegistrationRequestRow>(
    `select ${REGISTRATION_REQUEST_COLUMNS_WITH_PROCESSOR}
     from public.account_registration_requests arr
     left join public.users admin_u on admin_u.id = arr.processed_by_user_id
     where arr.status = any($1)
     order by ${orderClause}
     ${limitClause}`,
    values
  );
  return result.rows.map(toRegistrationRequest);
}

/**
 * DB-1에서 REVOKE된 SECURITY DEFINER 함수를 service role 커넥션으로 호출한다.
 * p_admin_user_id를 넘기지 않으면(자동승인 경로) 함수가 내부에서 admin_whitelist를
 * 재조회해 자동승인 여부를 스스로 판단한다 — 호출자 입력을 신뢰하지 않는다.
 */
export async function approveRegistrationRequest(requestId: string): Promise<string> {
  const result = await pool.query<{ approve_account_registration_request: string }>(
    `select approve_account_registration_request($1) as approve_account_registration_request`,
    [requestId]
  );
  return result.rows[0].approve_account_registration_request;
}

/**
 * BE-3: Admin이 수동 승인할 때 호출한다. p_admin_user_id를 명시적으로 넘기므로,
 * DB 함수 내부가 이 값이 실제 활성 Admin인지 재검증한다(호출자 입력을 신뢰하지 않음).
 */
export async function approveRegistrationRequestByAdmin(
  requestId: string,
  adminUserId: string
): Promise<string> {
  const result = await pool.query<{ approve_account_registration_request: string }>(
    `select approve_account_registration_request($1, $2) as approve_account_registration_request`,
    [requestId, adminUserId]
  );
  return result.rows[0].approve_account_registration_request;
}

/**
 * BE-3: Admin 거부 처리. reject_account_registration_request RPC는 처리와 동시에
 * 저장돼있던 encrypted_password/app_password_hash를 즉시 폐기한다(DB 함수 책임).
 */
export async function rejectRegistrationRequest(
  requestId: string,
  adminUserId: string
): Promise<void> {
  await pool.query(`select reject_account_registration_request($1, $2)`, [requestId, adminUserId]);
}
