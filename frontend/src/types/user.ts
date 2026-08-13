// 백엔드 응답 타입 — backend/src/routes/auth.routes.ts의 toPublicUser() 응답과 1:1로 맞춘다.
// (5-project-principle.md 1번: 애플리케이션 타입은 DB/백엔드 응답에서 파생시키고
// 임의의 타입을 새로 정의하지 않는다.)
export interface AuthenticatedUser {
  id: string;
  email_alias: string;
  is_admin: boolean;
  status: "pending" | "approved" | "rejected" | "revoked";
  approved_at: string | null;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: AuthenticatedUser;
}

export interface RefreshResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
