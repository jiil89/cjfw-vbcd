// backend/src/routes/admin.routes.ts의 toPublicRegistrationRequest() 응답과 1:1로 맞춘다
// (docs/swagger.json AccountRegistrationRequest 스키마도 동일).
export interface AccountRegistrationRequest {
  id: string;
  email_alias: string;
  status: "pending" | "auto_approved" | "approved" | "rejected";
  processed_by_user_id: string | null;
  /** 수동 승인/거부 처리자의 CJ WORLD ID(표시용). 자동승인이면 null — "system"으로 표시. */
  processed_by_email_alias: string | null;
  processed_by_system: boolean;
  processed_at: string | null;
  resulting_user_id: string | null;
  preferred_room_ids: string[];
  created_at: string;
}

// backend/src/routes/admin.routes.ts의 toPublicLockedUser() 응답과 1:1로 맞춘다
// (20260820 로그인 브루트포스 잠금 — docs/swagger.json LockedUser 스키마도 동일).
export interface LockedUser {
  id: string;
  email_alias: string;
  failed_login_attempts: number;
  updated_at: string;
}
