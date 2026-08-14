import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import type { AccountRegistrationRequest } from "../types/admin";

const PENDING_KEY = ["admin", "registration-requests", "pending"];
const PROCESSED_KEY = ["admin", "registration-requests", "processed"];

// GET /admin/registration-requests — status 생략 시 pending만 반환(백엔드 기본값).
export function usePendingRequestsQuery() {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => httpClient<AccountRegistrationRequest[]>("/admin/registration-requests"),
  });
}

// GET /admin/registration-requests?status=processed — 승인/거부 완료 이력(FE-4 하단 목록).
export function useProcessedRequestsQuery() {
  return useQuery({
    queryKey: PROCESSED_KEY,
    queryFn: () => httpClient<AccountRegistrationRequest[]>("/admin/registration-requests?status=processed"),
  });
}

function useRegistrationRequestActionMutation(action: "approve" | "reject") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      httpClient<AccountRegistrationRequest>(`/admin/registration-requests/${requestId}/${action}`, {
        method: "POST",
      }),
    // 처리 후 pending 목록에서 사라지고 이력에 나타나야 하므로 두 쿼리 다 재조회한다.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: PROCESSED_KEY });
    },
  });
}

export function useApproveRequestMutation() {
  return useRegistrationRequestActionMutation("approve");
}

export function useRejectRequestMutation() {
  return useRegistrationRequestActionMutation("reject");
}
