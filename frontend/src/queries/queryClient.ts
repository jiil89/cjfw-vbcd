import { QueryClient } from "@tanstack/react-query";

// 서버 상태(예약 목록, 등록 요청 목록 등)는 전부 이 QueryClient가 캐시한다.
// Zustand(stores/)에는 클라이언트 전용 상태만 두고 서버 데이터를 복제하지 않는다
// (5-project-principle.md §6).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
