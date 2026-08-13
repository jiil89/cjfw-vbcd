// requireAuth 통과 후 req.user.isAdmin이 true인지 확인하는 미들웨어.
// 반드시 requireAuth 다음에 연결해야 한다 (req.user가 세팅되어 있어야 함).

import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./requireAuth";

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Access Token이 필요합니다." },
    });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Admin 권한이 필요합니다." },
    });
    return;
  }

  next();
}
