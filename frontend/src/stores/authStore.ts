import { create } from "zustand";
import type { AuthenticatedUser } from "../types/user";

// 5-project-principle.md §5: Access Token은 클라이언트 메모리(Zustand)에만 두고
// localStorage에 절대 저장하지 않는다. Refresh Token은 httpOnly 쿠키로만 존재하며
// 프론트 JS는 그 값을 읽을 수도, 저장할 수도 없다.
interface AuthState {
  accessToken: string | null;
  user: AuthenticatedUser | null;
  setSession: (accessToken: string, user: AuthenticatedUser) => void;
  /** /auth/refresh 성공 후 accessToken만 갱신할 때 사용 (user는 유지) */
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clearSession: () => set({ accessToken: null, user: null }),
}));

// 컴포넌트 밖(예: httpClient.ts)에서 React 훅 없이 현재 토큰을 읽기 위한 헬퍼.
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
