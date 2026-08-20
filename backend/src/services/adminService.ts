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
import { findLockedUsers, unlockUser, type User } from "../db/repositories/userRepository";

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

export class UserNotLockedError extends Error {
  code = "USER_NOT_LOCKED";
  constructor() {
    super("잠긴 계정을 찾을 수 없습니다(이미 해제되었거나 존재하지 않음).");
    this.name = "UserNotLockedError";
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

// [20260820 추가] 로그인 브루트포스 방어 잠금 해제. 등록 요청 승인/거부와 달리 이 조작은
// 새 계정/권한을 만들지 않으므로(단순히 잠금을 풀 뿐) DB RPC 이중검증까지는 두지 않는다 —
// adminRouter 전체에 이미 requireAuth + requireAdmin이 걸려 있어 충분하다
// (registration-request 승인/거부의 RPC 이중검증은 anon key로도 호출 가능한 구멍을 막기
// 위한 것이었는데, 이 리포지토리 함수는 service role 커넥션으로만 호출되므로 같은 위협이 없다).

/** Admin 승인 패널에 표시할, 로그인 실패로 잠긴 계정 목록. */
export async function listLockedUsers(): Promise<User[]> {
  return findLockedUsers();
}

/** 잠긴 계정의 잠금을 해제한다 — 상태를 active로, 실패 카운터를 0으로 되돌린다. */
export async function unlockUserAsAdmin(userId: string): Promise<void> {
  const unlocked = await unlockUser(userId);
  if (!unlocked) {
    throw new UserNotLockedError();
  }
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
