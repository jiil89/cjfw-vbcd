import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

/**
 * FE-5 라우팅 가드 — 로그인하지 않은 사용자는 챗봇 UI에 진입할 수 없다. RequireAdmin과
 * 마찬가지로 세션은 메모리(Zustand)에만 있으므로(FE-3), 새로고침 등으로 세션이 비어
 * 있으면 미로그인과 동일하게 취급한다(세션 복원은 이 Task의 스코프가 아님).
 */
export function RequireAuth({ children }: { children: ReactElement }) {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
