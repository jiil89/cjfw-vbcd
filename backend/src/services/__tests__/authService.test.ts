// authService.ts 유닛 테스트 — 로그인 브루트포스 잠금(20260820 마이그레이션)에 집중한다.
// 다른 인증 흐름(JWT 발급 등)은 이번 스코프가 아니라 새로 손대지 않는다.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories/userRepository", () => ({
  findUserByEmailAlias: vi.fn(),
  incrementFailedLoginAttempts: vi.fn(),
  lockUser: vi.fn(),
  resetFailedLoginAttempts: vi.fn(),
}));
vi.mock("../../db/repositories/registrationRequestRepository", () => ({
  findLatestRegistrationRequestByEmailAlias: vi.fn(),
}));
vi.mock("../../security/appPassword", () => ({
  verifyAppPassword: vi.fn(),
}));

import {
  findUserByEmailAlias,
  incrementFailedLoginAttempts,
  lockUser,
  resetFailedLoginAttempts,
  type User,
} from "../../db/repositories/userRepository";
import { verifyAppPassword } from "../../security/appPassword";
import {
  authenticateUser,
  AccountLockedError,
  AccountRevokedError,
  InvalidCredentialsError,
} from "../authService";
import { MAX_LOGIN_ATTEMPTS } from "../../tools/businessRules";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    emailAlias: "jiil",
    encryptedPassword: "enc",
    appPasswordHash: "hash",
    isAdmin: false,
    status: "active",
    approvedAt: "2026-01-01T00:00:00Z",
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    unattendedBookingConsentAt: null,
    unattendedBookingConsentRevokedAt: null,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

describe("authenticateUser -- 로그인 브루트포스 잠금", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("비밀번호가 틀리고 아직 상한 미만이면 카운트만 올리고 InvalidCredentialsError를 던진다", async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ failedLoginAttempts: 1 }));
    (verifyAppPassword as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (incrementFailedLoginAttempts as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    await expect(authenticateUser("jiil", "wrong")).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(incrementFailedLoginAttempts).toHaveBeenCalledWith("user-1");
    expect(lockUser).not.toHaveBeenCalled();
  });

  it(`MAX_LOGIN_ATTEMPTS(${MAX_LOGIN_ATTEMPTS})번째로 틀리면 계정을 잠그고 AccountLockedError를 던진다`, async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeUser({ failedLoginAttempts: MAX_LOGIN_ATTEMPTS - 1 })
    );
    (verifyAppPassword as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (incrementFailedLoginAttempts as ReturnType<typeof vi.fn>).mockResolvedValue(MAX_LOGIN_ATTEMPTS);

    await expect(authenticateUser("jiil", "wrong")).rejects.toBeInstanceOf(AccountLockedError);

    expect(lockUser).toHaveBeenCalledWith("user-1");
  });

  it("이미 잠긴 계정이면 비밀번호 검증 없이 즉시 AccountLockedError를 던진다", async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ status: "locked" }));

    await expect(authenticateUser("jiil", "whatever")).rejects.toBeInstanceOf(AccountLockedError);

    expect(verifyAppPassword).not.toHaveBeenCalled();
    expect(incrementFailedLoginAttempts).not.toHaveBeenCalled();
  });

  it("로그인에 성공하면 남아있던 실패 카운트를 리셋한다", async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ failedLoginAttempts: 3 }));
    (verifyAppPassword as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const user = await authenticateUser("jiil", "correct");

    expect(user.id).toBe("user-1");
    expect(resetFailedLoginAttempts).toHaveBeenCalledWith("user-1");
  });

  it("로그인 성공 시 실패 카운트가 이미 0이면 리셋 쿼리를 굳이 부르지 않는다", async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ failedLoginAttempts: 0 }));
    (verifyAppPassword as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await authenticateUser("jiil", "correct");

    expect(resetFailedLoginAttempts).not.toHaveBeenCalled();
  });

  it("동의 철회(revoked) 계정은 잠금 로직보다 먼저 걸러진다", async () => {
    (findUserByEmailAlias as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser({ status: "revoked" }));

    await expect(authenticateUser("jiil", "whatever")).rejects.toBeInstanceOf(AccountRevokedError);

    expect(verifyAppPassword).not.toHaveBeenCalled();
  });
});
