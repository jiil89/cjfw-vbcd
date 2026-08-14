import { useMutation, useQuery } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import type { Room } from "../types/room";
import type { RegisterRequestBody, RegisterResponse } from "../types/registration";

// GET /rooms — anon 공개 조회. 회원가입 페이지의 선호 회의실 선택 UI가 사용한다.
// (5-project-principle.md §6: 서버 상태는 TanStack Query가 캐시한다.)
export function useRoomsQuery() {
  return useQuery({
    queryKey: ["rooms"],
    queryFn: () => httpClient<Room[]>("/rooms"),
    // 회의실 목록은 회원가입 세션 동안 바뀔 일이 거의 없으므로 재요청을 아낀다.
    staleTime: 5 * 60 * 1000,
  });
}

// POST /auth/register — 공개(anon) 엔드포인트. 중복 ID(409 EMAIL_ALIAS_TAKEN) 등은
// httpClient가 HttpError로 던지고, 호출부(RegisterPage)가 mutation.error에서 메시지를 꺼내 표시한다.
export function useRegisterMutation() {
  return useMutation({
    mutationFn: (body: RegisterRequestBody) =>
      httpClient<RegisterResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}
