// JWT 발급/검증/재발급/폐기. 5-project-principle.md §3: accessToken/refreshToken
// 네이밍을 어떤 함수에서도 생략하지 않는다.

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import {
  insertRefreshToken,
  findActiveRefreshTokenByHash,
  revokeRefreshTokenByHash,
} from "../db/repositories/refreshTokenRepository";
import { findUserByEmailAlias, findUserById, type User } from "../db/repositories/userRepository";
import { findLatestRegistrationRequestByEmailAlias } from "../db/repositories/registrationRequestRepository";
import { verifyAppPassword } from "../security/appPassword";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15분
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일

export interface AccessTokenPayload {
  userId: string;
  isAdmin: boolean;
}

interface RefreshTokenPayload {
  userId: string;
}

export function issueAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwtAccessTokenSecret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(accessToken: string): AccessTokenPayload {
  const decoded = jwt.verify(accessToken, config.jwtAccessTokenSecret);
  if (typeof decoded === "string") {
    throw new Error("[authService] access token payload가 올바르지 않습니다.");
  }
  return { userId: decoded.userId as string, isAdmin: decoded.isAdmin as boolean };
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash("sha256").update(refreshToken, "utf8").digest("hex");
}

/**
 * 새 Refresh Token을 발급하고, 폐기 가능하도록 해시값을 refresh_tokens에 저장한다
 * (토큰 원문 자체는 저장하지 않는다).
 */
export async function issueRefreshToken(userId: string): Promise<string> {
  const refreshToken = jwt.sign({ userId } satisfies RefreshTokenPayload, config.jwtRefreshTokenSecret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });

  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await insertRefreshToken({ userId, tokenHash, expiresAt });

  return refreshToken;
}

/**
 * Refresh Token으로 새 Access Token을 재발급한다.
 * (1) JWT 서명/만료를 검증하고, (2) refresh_tokens 테이블에서 해시로 조회해
 * revoked=false && 만료 전인지 재확인하고, (3) 재발급 시점의 최신 isAdmin/status를
 * 반영하기 위해 users를 다시 조회한 뒤에만 발급한다.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  let payload: RefreshTokenPayload;
  try {
    const decoded = jwt.verify(refreshToken, config.jwtRefreshTokenSecret);
    if (typeof decoded === "string") {
      throw new Error("invalid payload");
    }
    payload = { userId: decoded.userId as string };
  } catch {
    throw new RefreshTokenInvalidError();
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const record = await findActiveRefreshTokenByHash(tokenHash);
  if (!record || record.userId !== payload.userId) {
    throw new RefreshTokenInvalidError();
  }

  const user = await findUserById(payload.userId);
  if (!user || user.status !== "active") {
    throw new RefreshTokenInvalidError();
  }

  return issueAccessToken({ userId: user.id, isAdmin: user.isAdmin });
}

/** 로그아웃 시 Refresh Token 1건을 폐기한다. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await revokeRefreshTokenByHash(tokenHash);
}

export class RefreshTokenInvalidError extends Error {
  constructor() {
    super("Refresh token이 없거나 만료/폐기되었습니다.");
    this.name = "RefreshTokenInvalidError";
  }
}

// 로그인 실패 상태 구분 — 각각 다른 에러 코드로 응답해야 한다 (BE-2 완료 조건).
export class InvalidCredentialsError extends Error {
  code = "INVALID_CREDENTIALS";
  constructor() {
    super("사내 계정 ID 또는 비밀번호가 일치하지 않습니다.");
    this.name = "InvalidCredentialsError";
  }
}

export class RegistrationPendingError extends Error {
  code = "REGISTRATION_PENDING";
  constructor() {
    super("아직 관리자 승인 대기 중인 계정입니다.");
    this.name = "RegistrationPendingError";
  }
}

export class RegistrationRejectedError extends Error {
  code = "REGISTRATION_REJECTED";
  constructor() {
    super("등록 신청이 거부된 계정입니다.");
    this.name = "RegistrationRejectedError";
  }
}

export class AccountRevokedError extends Error {
  code = "ACCOUNT_REVOKED";
  constructor() {
    super("동의가 철회되어 더 이상 사용할 수 없는 계정입니다.");
    this.name = "AccountRevokedError";
  }
}

/**
 * 로그인 자격증명(email_alias + appPassword)을 검증한다. 실패 사유를 승인 대기/거부/
 * 자격증명 오류로 구분해 서로 다른 에러 타입으로 던진다. 평문 비밀번호는 어디에도 로깅하지 않는다.
 */
export async function authenticateUser(emailAlias: string, appPassword: string): Promise<User> {
  const user = await findUserByEmailAlias(emailAlias);

  if (!user) {
    const latestRequest = await findLatestRegistrationRequestByEmailAlias(emailAlias);
    if (latestRequest?.status === "pending") {
      throw new RegistrationPendingError();
    }
    if (latestRequest?.status === "rejected") {
      throw new RegistrationRejectedError();
    }
    throw new InvalidCredentialsError();
  }

  if (user.status === "revoked") {
    throw new AccountRevokedError();
  }

  const isValid = await verifyAppPassword(appPassword, user.appPasswordHash);
  if (!isValid) {
    throw new InvalidCredentialsError();
  }

  return user;
}
