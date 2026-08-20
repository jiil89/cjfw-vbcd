// GET /admin/registration-requests, POST /admin/registration-requests/:id/approve|reject
// docs/swagger.json Admin 태그 계약을 따른다. 모든 엔드포인트에 requireAuth + requireAdmin 필요.

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  listRegistrationRequests,
  approveRegistrationRequestAsAdmin,
  rejectRegistrationRequestAsAdmin,
  listLockedUsers,
  unlockUserAsAdmin,
  RegistrationRequestNotFoundError,
  RegistrationRequestNotPendingError,
  AdminNotActiveError,
  UserNotLockedError,
} from "../services/adminService";
import type { RegistrationRequest } from "../db/repositories/registrationRequestRepository";
import type { User } from "../db/repositories/userRepository";

const VALID_STATUS_FILTERS = ["pending", "auto_approved", "approved", "rejected", "processed"] as const;
type StatusFilter = (typeof VALID_STATUS_FILTERS)[number];

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

function toPublicRegistrationRequest(request: RegistrationRequest) {
  return {
    id: request.id,
    email_alias: request.emailAlias,
    status: request.status,
    processed_by_user_id: request.processedByUserId,
    processed_by_email_alias: request.processedByEmailAlias,
    processed_by_system: request.processedBySystem,
    processed_at: request.processedAt,
    resulting_user_id: request.resultingUserId,
    preferred_room_ids: request.preferredRoomIds,
    created_at: request.createdAt,
  };
}

// FE-4: status=processed는 문서화된 4개 상태 enum 밖의 편의 값이라(auto_approved/approved/
// rejected 3개를 한 번에), swagger의 열거값과 별도로 여기서만 화이트리스트 검증한다.
function isValidStatusFilter(value: string): value is StatusFilter {
  return (VALID_STATUS_FILTERS as readonly string[]).includes(value);
}

adminRouter.get("/registration-requests", async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.query;

  if (status !== undefined && (typeof status !== "string" || !isValidStatusFilter(status))) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: `status는 ${VALID_STATUS_FILTERS.join(", ")} 중 하나여야 합니다.`,
      },
    });
    return;
  }

  try {
    const requests = await listRegistrationRequests(status as StatusFilter | undefined);
    res.status(200).json(requests.map(toPublicRegistrationRequest));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[admin.routes] list registration requests failed", error);
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

// [20260820 추가] 로그인 5회 실패로 잠긴 계정 목록 조회 + Admin의 잠금 해제.
// businessRules.ts의 MAX_LOGIN_ATTEMPTS 참고 — 브루트포스 방어를 자가 재설정이 아니라
// Admin 대행으로만 풀게 한 이유는 비밀번호 변경 절 참고(메일 발송 수단이 없어 본인 확인 불가).

function toPublicLockedUser(user: User) {
  // 비밀번호/암호문은 절대 응답에 포함하지 않는다 — 이름을 명시한 필드만 내보낸다
  // (registration-request 응답과 동일한 원칙).
  return {
    id: user.id,
    email_alias: user.emailAlias,
    failed_login_attempts: user.failedLoginAttempts,
    updated_at: user.updatedAt,
  };
}

adminRouter.get("/locked-users", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await listLockedUsers();
    res.status(200).json(users.map(toPublicLockedUser));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[admin.routes] list locked users failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "잠긴 계정 목록 조회 중 오류가 발생했습니다." },
    });
  }
});

adminRouter.post("/locked-users/:id/unlock", async (req: AuthenticatedRequest, res: Response) => {
  try {
    await unlockUserAsAdmin(req.params.id);
    res.status(204).end();
  } catch (error) {
    handleAdminActionError(error, res);
  }
});

function handleAdminActionError(error: unknown, res: Response): void {
  if (error instanceof RegistrationRequestNotFoundError || error instanceof UserNotLockedError) {
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
  console.error("[admin.routes] admin action failed", error);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "요청 처리 중 오류가 발생했습니다." },
  });
}
