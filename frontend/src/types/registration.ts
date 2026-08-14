// backend/src/routes/registration.routes.ts의 POST /auth/register 요청/응답과 1:1로 맞춘다.
export interface RegisterRequestBody {
  email_alias: string;
  corporate_password: string;
  app_password: string;
  preferred_room_ids?: string[];
}

export interface RegisterResponse {
  id: string;
  status: "pending" | "auto_approved";
  message: string;
}
