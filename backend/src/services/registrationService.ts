// 회원가입 신청 처리. 5-project-principle.md §1: CJ WORLD PW와 앱 로그인
// 비밀번호는 각각 다른 security/ 모듈을 통해서만 다룬다 — 이 파일이 직접 암호화/해시
// 로직을 구현하지 않는다.

import { encryptCorporatePassword } from "../security/corporatePassword";
import { hashAppPassword } from "../security/appPassword";
import {
  isEmailAliasTaken,
  isEmailAliasWhitelisted,
  insertPendingRegistrationRequest,
  approveRegistrationRequest,
  type RegistrationRequest,
} from "../db/repositories/registrationRequestRepository";
import { findRoomsByIds } from "../db/repositories/roomRepository";
import { setPreferredRooms } from "../db/repositories/userPreferredRoomRepository";

export class EmailAliasTakenError extends Error {
  code = "EMAIL_ALIAS_TAKEN";
  constructor() {
    super("이미 등록되었거나 처리 대기 중인 CJ WORLD ID입니다.");
    this.name = "EmailAliasTakenError";
  }
}

export interface RegisterAccountParams {
  emailAlias: string;
  corporatePassword: string;
  appPassword: string;
  /** 선호 회의실 ID 목록. 배열 순서가 우선순위(첫 번째가 1순위). 생략 가능(빈 배열). */
  preferredRoomIds: string[];
}

export interface RegisterAccountResult {
  id: string;
  status: "pending" | "auto_approved";
}

/**
 * 회원가입 신청을 접수한다.
 * - email_alias 중복(이미 승인된 사용자이거나 pending 신청 존재)이면 거부한다.
 * - 항상 status='pending'으로 먼저 접수한 뒤, admin_whitelist 매칭이면 즉시
 *   approve_account_registration_request RPC를 호출해 users row까지 생성한다
 *   (DB-1의 안전한 함수 호출 경로 — 자동승인 여부는 함수 내부가 재검증한다).
 * - 매칭이 아니면 pending 상태로 남겨 Admin 승인 대기.
 */
export async function registerAccount(
  params: RegisterAccountParams
): Promise<RegisterAccountResult> {
  const alreadyTaken = await isEmailAliasTaken(params.emailAlias);
  if (alreadyTaken) {
    throw new EmailAliasTakenError();
  }

  const encryptedPassword = encryptCorporatePassword(params.corporatePassword);
  const appPasswordHash = await hashAppPassword(params.appPassword);

  // 존재하지 않는 room_id가 섞여 들어와도(클라이언트 버그 등) 조용히 걸러낸다 — 공개
  // 엔드포인트라 입력을 신뢰하지 않는다(5-project-principle.md "시스템 경계에서만 검증").
  const validPreferredRoomIds =
    params.preferredRoomIds.length > 0
      ? (await findRoomsByIds(params.preferredRoomIds)).map((room) => room.id)
      : [];
  // findRoomsByIds는 존재 여부만 걸러낼 뿐 입력 순서를 보존하므로, 우선순위 순서는
  // 그대로 유지된다(userId 배열 자체가 이미 우선순위 순).

  const request: RegistrationRequest = await insertPendingRegistrationRequest({
    emailAlias: params.emailAlias,
    encryptedPassword,
    appPasswordHash,
    preferredRoomIds: validPreferredRoomIds,
  });

  const isWhitelisted = await isEmailAliasWhitelisted(params.emailAlias);
  if (!isWhitelisted) {
    return { id: request.id, status: "pending" };
  }

  const newUserId = await approveRegistrationRequest(request.id);
  await setPreferredRooms(newUserId, validPreferredRoomIds);

  return { id: request.id, status: "auto_approved" };
}
