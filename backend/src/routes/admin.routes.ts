// GET /admin/registration-requests, POST /admin/registration-requests/:id/approve|reject
// docs/swagger.json Admin 태그 계약을 따른다. 모든 엔드포인트에 requireAuth + requireAdmin 필요.

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  listPendingRegistrationRequests,
  approveRegistrationRequestAsAdmin,
  rejectRegistrationRequestAsAdmin,
  RegistrationRequestNotFoundError,
  RegistrationRequestNotPendingError,
  AdminNotActiveError,
} from "../services/adminService";
import type { RegistrationRequest } from "../db/repositories/registrationRequestRepository";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

function toPublicRegistrationRequest(request: RegistrationRequest) {
  return {
    id: request.id,
    email_alias: request.emailAlias,
    status: request.status,
    processed_by_user_id: request.processedByUserId,
    processed_by_system: request.processedBySystem,
    processed_at: request.processedAt,
    resulting_user_id: request.resultingUserId,
    created_at: request.createdAt,
  };
}

adminRouter.get("/registration-requests", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const requests = await listPendingRegistrationRequests();
    res.status(200).json(requests.map(toPublicRegistrationRequest));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[admin.routes] list pending requests failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "등록 요청 목록 조회 중 오류가 발생했습니다." },
    });
  }
});

adminRouter.post(
  "/registration-requests/:id/approve",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = await approveRegistrationRequestAsAdmin(req.params.id, req.user!.userId);
      res.status(200).json(toPublicRegistrationRequest(request));
    } catch (error) {
      handleAdminActionError(error, res);
    }
  }
);

adminRouter.post(
  "/registration-requests/:id/reject",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request = await rejectRegistrationRequestAsAdmin(req.params.id, req.user!.userId);
      res.status(200).json(toPublicRegistrationRequest(request));
    } catch (error) {
      handleAdminActionError(error, res);
    }
  }
);

function handleAdminActionError(error: unknown, res: Response): void {
  if (error instanceof RegistrationRequestNotFoundError) {
    res.status(404).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof RegistrationRequestNotPendingError) {
    res.status(409).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof AdminNotActiveError) {
    res.status(403).json({ error: { code: error.code, message: error.message } });
    return;
  }
  // eslint-disable-next-line no-console
  console.error("[admin.routes] registration request action failed", error);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "등록 요청 처리 중 오류가 발생했습니다." },
  });
}
