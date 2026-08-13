// 회원가입 신청 처리. 5-project-principle.md §1: 사내 계정 비밀번호와 앱 로그인
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

export class EmailAliasTakenError extends Error {
  code = "EMAIL_ALIAS_TAKEN";
  constructor() {
    super("이미 등록되었거나 처리 대기 중인 사내 계정 ID입니다.");
    this.name = "EmailAliasTakenError";
  }
}

export interface RegisterAccountParams {
  emailAlias: string;
  corporatePassword: string;
  appPassword: string;
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

  const request: RegistrationRequest = await insertPendingRegistrationRequest({
    emailAlias: params.emailAlias,
    encryptedPassword,
    appPasswordHash,
  });

  const isWhitelisted = await isEmailAliasWhitelisted(params.emailAlias);
  if (!isWhitelisted) {
    return { id: request.id, status: "pending" };
  }

  await approveRegistrationRequest(request.id);

  return { id: request.id, status: "auto_approved" };
}
