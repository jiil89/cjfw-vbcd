import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

/**
 * FE-4 라우팅 가드 — Admin 권한이 없는 사용자는 Admin 패널에 진입할 수 없다.
 * 로그인 자체를 안 한 상태면 /login으로, 로그인은 했지만 Admin이 아니면 자신의
 * 홈 화면(/chat)으로 보낸다. 세션은 메모리(Zustand)에만 있으므로(FE-3), 새로고침
 * 등으로 세션이 비어 있으면 미로그인과 동일하게 취급한다 — 세션 복원(refresh
 * 부트스트랩)은 이 Task의 스코프가 아니다.
 */
export function RequireAdmin({ children }: { children: ReactElement }) {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.is_admin) {
    return <Navigate to="/chat" replace />;
  }
  return children;
}
