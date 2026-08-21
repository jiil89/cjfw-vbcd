import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpClient } from "../api/httpClient";
import type {
  CreateRecurringRuleBody,
  CreateRecurringRuleResponse,
  RecurringRule,
  UnattendedConsent,
} from "../types/recurring";

const RECURRING_RULES_KEY = ["me", "recurring-rules"];
const UNATTENDED_CONSENT_KEY = ["me", "unattended-consent"];

// GET /me/recurring-rules — 사이드바 "매주 반복 예약" 목록 전용.
export function useRecurringRulesQuery() {
  return useQuery({
    queryKey: RECURRING_RULES_KEY,
    queryFn: () => httpClient<RecurringRule[]>("/me/recurring-rules"),
  });
}

// GET /me/unattended-consent — 무인 자동 실행 동의 여부. 폼을 보여줄지 동의 안내를
// 보여줄지 가르는 게이트 값이다.
export function useUnattendedConsentQuery() {
  return useQuery({
    queryKey: UNATTENDED_CONSENT_KEY,
    queryFn: () => httpClient<UnattendedConsent>("/me/unattended-consent"),
  });
}

// POST /me/recurring-rules — 새 규칙 등록. 성공하면 목록을 다시 불러온다.
export function useCreateRecurringRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRecurringRuleBody) =>
      httpClient<CreateRecurringRuleResponse>("/me/recurring-rules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECURRING_RULES_KEY });
    },
  });
}

// PATCH /me/recurring-rules/:id — 활성/비활성 토글.
export function useToggleRecurringRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      httpClient<void>(`/me/recurring-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECURRING_RULES_KEY });
    },
  });
}

// DELETE /me/recurring-rules/:id
export function useDeleteRecurringRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => httpClient<void>(`/me/recurring-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECURRING_RULES_KEY });
    },
  });
}

// POST /me/unattended-consent — 무인 자동 실행 동의.
export function useGiveUnattendedConsentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => httpClient<void>("/me/unattended-consent", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNATTENDED_CONSENT_KEY });
    },
  });
}

// DELETE /me/unattended-consent — 동의 철회. 서버가 기존 규칙을 모두 비활성화하므로
// 규칙 목록도 함께 다시 불러온다.
export function useRevokeUnattendedConsentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => httpClient<void>("/me/unattended-consent", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNATTENDED_CONSENT_KEY });
      queryClient.invalidateQueries({ queryKey: RECURRING_RULES_KEY });
    },
  });
}
