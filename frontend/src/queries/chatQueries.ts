import { useMutation, useQuery } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import type { ChatMessageResponse, MyReservationGroup } from "../types/chat";
import type { Room } from "../types/room";

// POST /chat/messages — 예약 관련 모든 유스케이스의 유일한 진입점(BE-8). 요청은
// message 하나뿐이고, 대화 맥락(세션 상태)은 서버가 userId 기준으로 들고 있다
// (backend/src/orchestration/sessionStore.ts) — 클라이언트가 session_id를 관리할 필요 없다.
export function useSendChatMessageMutation() {
  return useMutation({
    mutationFn: (message: string) =>
      httpClient<ChatMessageResponse>("/chat/messages", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
  });
}

// GET /me/reservations/today — 사이드바 "오늘 예약" 전용(FE-5 신규).
export function useTodayReservationsQuery() {
  return useQuery({
    queryKey: ["me", "reservations", "today"],
    queryFn: () => httpClient<MyReservationGroup[]>("/me/reservations/today"),
  });
}

// GET /me/preferred-rooms — 사이드바 "선호 회의실" 전용(FE-5 신규). 배열 순서가 우선순위.
export function usePreferredRoomsQuery() {
  return useQuery({
    queryKey: ["me", "preferred-rooms"],
    queryFn: () => httpClient<Room[]>("/me/preferred-rooms"),
  });
}

// PATCH /me/cj-world-password — 서버가 새 비밀번호로 CJ에 실제 로그인해서 검증한 뒤에만
// 저장하므로(오타로 잠기는 걸 막는다) 응답이 수 초 걸릴 수 있다.
export function useChangeCjWorldPasswordMutation() {
  return useMutation({
    mutationFn: (body: { new_cj_world_password: string }) =>
      httpClient<void>("/me/cj-world-password", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  });
}

// PATCH /me/app-password — 성공하면 서버가 refresh 토큰을 전부 폐기한다(기존 세션 종료).
export function useChangeAppPasswordMutation() {
  return useMutation({
    mutationFn: (body: { current_app_password: string; new_app_password: string }) =>
      httpClient<void>("/me/app-password", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  });
}
