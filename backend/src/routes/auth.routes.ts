// POST /auth/login, /auth/refresh, /auth/logout.
// docs/swagger.json 계약: Access Token은 응답 바디, Refresh Token은 httpOnly 쿠키.

import { Router, type Request, type Response } from "express";
import { config } from "../config/env";
import {
  authenticateUser,
  issueAccessToken,
  issueRefreshToken,
  refreshAccessToken,
  revokeRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  InvalidCredentialsError,
  RegistrationPendingError,
  RegistrationRejectedError,
  AccountRevokedError,
  RefreshTokenInvalidError,
} from "../services/authService";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import type { User } from "../db/repositories/userRepository";

export const authRouter = Router();

const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일

// 5-project-principle.md §5: Secure 플래그는 NODE_ENV 기준으로 토글, SameSite=Lax(same-origin 전제).
function refreshTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax" as const,
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email_alias: user.emailAlias,
    is_admin: user.isAdmin,
    status: user.status,
    approved_at: user.approvedAt,
    created_at: user.createdAt,
  };
}

authRouter.post("/login", async (req: Request, res: Response) => {
  const { email_alias, app_password } = req.body ?? {};

  if (typeof email_alias !== "string" || typeof app_password !== "string") {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "email_alias, app_password는 필수입니다." },
    });
    return;
  }

  try {
    const user = await authenticateUser(email_alias, app_password);

    const accessToken = issueAccessToken({ userId: user.id, isAdmin: user.isAdmin });
    const refreshToken = await issueRefreshToken(user.id);

    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, refreshTokenCookieOptions());
    res.status(200).json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      user: toPublicUser(user),
    });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (
      error instanceof RegistrationPendingError ||
      error instanceof RegistrationRejectedError ||
      error instanceof AccountRevokedError
    ) {
      res.status(403).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[auth.routes] login failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "로그인 처리 중 오류가 발생했습니다." },
    });
  }
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

  if (!refreshToken || typeof refreshToken !== "string") {
    res.status(401).json({
      error: { code: "REFRESH_TOKEN_MISSING", message: "Refresh Token 쿠키가 없습니다." },
    });
    return;
  }

  try {
    const accessToken = await refreshAccessToken(refreshToken);
    res.status(200).json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    if (error instanceof RefreshTokenInvalidError) {
      res.status(401).json({ error: { code: "REFRESH_TOKEN_INVALID", message: error.message } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[auth.routes] refresh failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "토큰 재발급 중 오류가 발생했습니다." },
    });
  }
});

authRouter.post("/logout", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

  if (refreshToken && typeof refreshToken === "string") {
    await revokeRefreshToken(refreshToken);
  }

  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { ...refreshTokenCookieOptions(), maxAge: undefined });
  res.status(204).send();
});
