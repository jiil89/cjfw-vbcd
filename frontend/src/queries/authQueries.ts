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

// POST /auth/cj-world-password — 로그인 전 복구 경로. CJ WORLD PW가 바뀌면 로그인 자체가
// 거부되므로(CJ_LOGIN_FAILED) 앱 안의 변경 화면에 도달할 수 없다. 그래서 앱 로그인 비밀번호로
// 본인을 확인하고 새 CJ WORLD PW를 다시 등록하는 경로를 로그인 화면에서 제공한다.
export function useRecoverCjWorldPasswordMutation() {
  return useMutation({
    mutationFn: (body: { email_alias: string; app_password: string; new_cj_world_password: string }) =>
      httpClient<void>("/auth/cj-world-password", {
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
