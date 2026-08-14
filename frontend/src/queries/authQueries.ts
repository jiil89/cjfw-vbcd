import { useMutation } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import { useAuthStore } from "../stores/authStore";
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

// POST /auth/logout — requireAuth 엔드포인트라 httpClient가 Authorization 헤더를 자동 첨부한다.
// 서버가 Refresh Token을 폐기하고 나면(204) 클라이언트 세션(Zustand)도 즉시 비운다.
export function useLogoutMutation() {
  const clearSession = useAuthStore((state) => state.clearSession);
  return useMutation({
    mutationFn: () => httpClient<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      // 서버 호출이 실패하더라도(네트워크 오류 등) 클라이언트 쪽 세션은 비워 로그아웃을 보장한다.
      clearSession();
    },
  });
}
