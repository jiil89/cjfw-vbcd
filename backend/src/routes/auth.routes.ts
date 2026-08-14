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
import { getValidSession } from "../cj-automation/session";
import { clearCachedCjSession } from "../cj-automation/sessionCache";
import { withTimeout } from "../lib/withTimeout";

export const authRouter = Router();

// [2026-08-14, 사용자 요청] 로그인 시점에 CJ 세션을 미리 확보해 sessionCache.ts에 캐싱해두면
// 이후 채팅에서 회의실 조회/예약 도구를 쓸 때 로그인 지연 없이 바로 시작할 수 있다 — 대신
// 로그인 자체가 이만큼 느려지는 것을 사용자가 감수하기로 함(속도가 "사라지는" 게 아니라 로그인
// 시점으로 옮겨지는 것). CJ가 응답 없거나 느릴 때 로그인 자체가 무한정 걸리지 않도록 상한을
// 둔다(관찰된 정상 CJ 로그인 시간보다 넉넉하게).
const CJ_LOGIN_CHECK_TIMEOUT_MS = 45_000;

// [2026-08-14, 재수정 — 사용자 요청] 처음엔 "CJ 예열 실패해도 앱 로그인은 막지 않는다"였는데,
// 그렇게 하면 실제로 존재하지 않는/틀린 CJ 계정으로 가입·승인된 사용자도 앱 로그인 자체는
// 항상 성공해버려서 "로그인은 되는데 챗봇에서 아무 예약도 안 되는" 혼란스러운 상태로 들어가게
// 됨을 실사용으로 확인함(test001 사례). 이 앱은 CJ 세션 없이는 어차피 아무 기능도 못 쓰므로,
// CJ 인증 실패를 로그인 시점에 바로 거부하는 게 더 안전하다 — "가짜 계정으로도 들어와지는" 대신
// "가짜 계정은 로그인 자체가 안 되는" 쪽으로 실패 지점을 앞당긴다.
//
// 계층 원칙(5-project-principle.md §2)은 orchestration→tools→cj-automation 방향을 강제하는데,
// 이건 "예약 도구" 호출이 아니라 로그인 시점의 세션 확인(횡단 관심사)이라 그 체인 밖의 의도된
// 예외로 cj-automation을 직접 부른다 — tools/*를 거칠 이유가 없는 단순 위임.
async function requireCjSessionOnLogin(userId: string): Promise<void> {
  await withTimeout(getValidSession(userId), CJ_LOGIN_CHECK_TIMEOUT_MS, "CJ 세션 확인 시간이 초과되었습니다.");
}

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

    try {
      await requireCjSessionOnLogin(user.id);
    } catch (cjError) {
      // eslint-disable-next-line no-console
      console.error("[auth.routes] CJ 계정 인증 실패로 로그인 거부", cjError);
      res.status(401).json({
        error: {
          code: "CJ_LOGIN_FAILED",
          message: "CJ 사내 계정 인증에 실패했습니다. 계정 ID·비밀번호를 확인하거나 관리자에게 문의해주세요.",
        },
      });
      return;
    }

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

  clearCachedCjSession(req.user!.userId);

  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { ...refreshTokenCookieOptions(), maxAge: undefined });
  res.status(204).send();
});
