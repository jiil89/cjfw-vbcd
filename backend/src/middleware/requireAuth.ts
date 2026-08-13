// Authorization: Bearer <accessToken> 검증 미들웨어.

import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../services/authService";

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; isAdmin: boolean };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Access Token이 필요합니다." },
    });
    return;
  }

  const accessToken = header.slice("Bearer ".length).trim();

  try {
    const payload = verifyAccessToken(accessToken);
    req.user = { userId: payload.userId, isAdmin: payload.isAdmin };
    next();
  } catch {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Access Token이 없거나 만료되었습니다." },
    });
  }
}
