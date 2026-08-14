import { useMutation } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import type { LoginResponse } from "../types/user";

// POST /auth/login — 성공 시 access_token(응답 바디)+user, refresh_token은 백엔드가
// httpOnly 쿠키로 심는다(여기서 직접 다루지 않음). 실패 시 httpClient가 HttpError로
// 던지고, 호출부(LoginPage)가 error.code로 승인대기/거부/자격증명오류를 구분해 표시한다.
export function useLoginMutation() {
  return useMutation({
    mutationFn: (body: { email_alias: string; app_password: string }) =>
      httpClient<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}
