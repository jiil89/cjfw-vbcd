// [레이어 3] 서비스 — 비밀번호 변경.
//
// 이 앱은 성격이 다른 비밀번호를 두 개 다룬다(5-project-principle.md §1/§3):
// - CJ WORLD PW: CJ 시스템에 실제로 로그인해야 하므로 복호화 가능한 암호문으로 보관
// - 앱 로그인 비밀번호: 단방향 해시. 평문을 어디에도 남기지 않는다
// 두 값을 한 함수에서 같이 다루지 않고, 아래처럼 각각 분리해서 처리한다.

import { loginWithCredentials, CjLoginError } from "../cj-automation/session";
import { clearCachedCjSession } from "../cj-automation/sessionCache";
import { revokeAllRefreshTokensByUserId } from "../db/repositories/refreshTokenRepository";
import {
  findUserById,
  updateAppPasswordHash,
  updateEncryptedPassword,
} from "../db/repositories/userRepository";
import { hashAppPassword, verifyAppPassword } from "../security/appPassword";
import { encryptCorporatePassword } from "../security/corporatePassword";

export class UserNotFoundError extends Error {
  code = "USER_NOT_FOUND";
  constructor() {
    super("사용자를 찾을 수 없습니다.");
    this.name = "UserNotFoundError";
  }
}

/** 새로 입력한 CJ WORLD PW로 CJ 로그인이 실제로 되지 않는 경우. */
export class CjWorldPasswordInvalidError extends Error {
  code = "CJ_WORLD_PASSWORD_INVALID";
  constructor() {
    super("새 CJ WORLD PW로 CJ 시스템 로그인에 실패했습니다. 비밀번호를 다시 확인해주세요.");
    this.name = "CjWorldPasswordInvalidError";
  }
}

/** 앱 비밀번호 변경 시 현재 비밀번호가 틀린 경우. */
export class CurrentAppPasswordMismatchError extends Error {
  code = "CURRENT_PASSWORD_MISMATCH";
  constructor() {
    super("현재 앱 로그인 비밀번호가 일치하지 않습니다.");
    this.name = "CurrentAppPasswordMismatchError";
  }
}

/**
 * CJ WORLD PW를 새 값으로 교체한다.
 *
 * 저장 전에 반드시 CJ에 실제로 로그인해서 검증한다 — 검증 없이 저장하면 오타 하나로
 * 이후 모든 조회/예약이 CjLoginError로 죽는데, 사용자는 자기가 뭘 잘못했는지 알 수 없고
 * 되돌릴 방법도 없다(그게 애초에 이 기능이 필요해진 이유다). 검증에 성공한 값만 저장하고,
 * 옛 비밀번호로 맺어둔 CJ 세션 캐시는 즉시 버린다.
 */
export async function changeCjWorldPassword(userId: string, newCjWorldPassword: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();

  try {
    await loginWithCredentials(user.emailAlias, newCjWorldPassword);
  } catch (err) {
    if (err instanceof CjLoginError) {
      throw new CjWorldPasswordInvalidError();
    }
    throw err;
  }

  await updateEncryptedPassword(userId, encryptCorporatePassword(newCjWorldPassword));
  clearCachedCjSession(userId);
}

/**
 * 앱 로그인 비밀번호를 교체한다. 현재 비밀번호를 확인한 뒤에만 바꾸고, 성공하면 이 사용자의
 * refresh 토큰을 전부 폐기해 기존 세션을 끊는다.
 */
export async function changeAppPassword(
  userId: string,
  currentAppPassword: string,
  newAppPassword: string
): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();

  const matches = await verifyAppPassword(currentAppPassword, user.appPasswordHash);
  if (!matches) throw new CurrentAppPasswordMismatchError();

  await updateAppPasswordHash(userId, await hashAppPassword(newAppPassword));
  await revokeAllRefreshTokensByUserId(userId);
}
