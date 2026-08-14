// Admin 승인 패널 서비스. pending 등록 요청 조회 + 승인/거부 처리.
// 승인/거부는 항상 DB-1의 안전한 RPC(approve_account_registration_request /
// reject_account_registration_request)를 통해서만 이루어진다 — 이 파일이 users/
// account_registration_requests를 직접 UPDATE하지 않는다.

import {
  findRegistrationRequestsByStatuses,
  findRegistrationRequestById,
  approveRegistrationRequestByAdmin,
  rejectRegistrationRequest,
  type RegistrationRequest,
  type RegistrationRequestStatus,
} from "../db/repositories/registrationRequestRepository";
import { setPreferredRooms } from "../db/repositories/userPreferredRoomRepository";

export class RegistrationRequestNotFoundError extends Error {
  code = "NOT_FOUND";
  constructor() {
    super("등록 요청을 찾을 수 없습니다.");
    this.name = "RegistrationRequestNotFoundError";
  }
}

export class RegistrationRequestNotPendingError extends Error {
  code = "REQUEST_NOT_PENDING";
  constructor() {
    super("이미 처리된 요청입니다.");
    this.name = "RegistrationRequestNotPendingError";
  }
}

export class AdminNotActiveError extends Error {
  code = "FORBIDDEN";
  constructor() {
    super("요청을 처리하는 Admin 계정이 유효하지 않습니다.");
    this.name = "AdminNotActiveError";
  }
}

const PROCESSED_STATUSES: RegistrationRequestStatus[] = ["auto_approved", "approved", "rejected"];

/**
 * `docs/swagger.json`의 `GET /admin/registration-requests?status=` 계약: status 생략 시
 * pending만 반환한다. `status=approved` 등 처리 완료 상태 하나를 넘기면 그 상태만,
 * 그 외 값이면 400으로 거부한다(라우트에서 처리). "처리 완료 이력" 전체(FE-4 와이어프레임
 * "처리 완료 이력")를 한 번에 보고 싶을 때는 편의상 status를 생략 대신 처리 완료 3종
 * 상태를 한 번에 묶어 반환한다(HTTP 다중 상태 쿼리 파라미터를 새로 설계하지 않기 위한
 * 실용적 선택 — 오버엔지니어링 방지).
 *
 * 비밀번호/암호문은 repository의 SELECT 컬럼 자체에 포함되지 않으므로 여기서 다시 제거할 것이 없다.
 */
export async function listRegistrationRequests(
  status?: RegistrationRequestStatus | "processed"
): Promise<RegistrationRequest[]> {
  if (status === undefined) {
    return findRegistrationRequestsByStatuses(["pending"]);
  }
  if (status === "processed") {
    return findRegistrationRequestsByStatuses(PROCESSED_STATUSES);
  }
  return findRegistrationRequestsByStatuses([status]);
}

/**
 * requestId가 존재하고 pending 상태인지 먼저 확인해 404/409를 명확히 구분한 뒤,
 * 실제 승인/거부는 DB RPC가 원자적으로 처리한다(요청 상태 갱신 + users insert 또는
 * 자격증명 폐기까지 트랜잭션 하나).
 */
async function assertPendingRequestExists(requestId: string): Promise<void> {
  const request = await findRegistrationRequestById(requestId);
  if (!request) {
    throw new RegistrationRequestNotFoundError();
  }
  if (request.status !== "pending") {
    throw new RegistrationRequestNotPendingError();
  }
}

function mapRpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("not found")) {
    return new RegistrationRequestNotFoundError();
  }
  if (message.includes("is not pending") || message.includes("not pending")) {
    return new RegistrationRequestNotPendingError();
  }
  if (message.includes("is not an active admin")) {
    return new AdminNotActiveError();
  }
  return error instanceof Error ? error : new Error(message);
}

export async function approveRegistrationRequestAsAdmin(
  requestId: string,
  adminUserId: string
): Promise<RegistrationRequest> {
  await assertPendingRequestExists(requestId);

  try {
    await approveRegistrationRequestByAdmin(requestId, adminUserId);
  } catch (error) {
    throw mapRpcError(error);
  }

  const updated = await findRegistrationRequestById(requestId);
  if (!updated) {
    throw new RegistrationRequestNotFoundError();
  }
  // 신청 단계에서 골라둔 선호 회의실(preferred_room_ids)을 이제 막 생성된 사용자에게 옮긴다.
  // resultingUserId는 RPC가 방금 새로 만든 users row라서 항상 존재한다.
  if (updated.resultingUserId) {
    await setPreferredRooms(updated.resultingUserId, updated.preferredRoomIds);
  }
  return updated;
}

export async function rejectRegistrationRequestAsAdmin(
  requestId: string,
  adminUserId: string
): Promise<RegistrationRequest> {
  await assertPendingRequestExists(requestId);

  try {
    await rejectRegistrationRequest(requestId, adminUserId);
  } catch (error) {
    throw mapRpcError(error);
  }

  const updated = await findRegistrationRequestById(requestId);
  if (!updated) {
    throw new RegistrationRequestNotFoundError();
  }
  return updated;
}
