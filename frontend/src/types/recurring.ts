// 매주 반복 예약 — backend GET/POST /me/recurring-rules, GET/POST/DELETE
// /me/unattended-consent 응답과 1:1로 맞춘다 (지시받은 API 계약 그대로).
// (5-project-principle.md 1번: 애플리케이션 타입은 백엔드 응답에서 파생시킨다.)

/** 규칙에 걸린 회의실 하나 — priority가 우선순위(1부터). */
export interface RecurringRuleRoom {
  room_id: string;
  room_name: string;
  floor_label: string | null;
  priority: number;
}

export type RecurringRunStatus = "succeeded" | "failed" | "skipped";

/** 대상일 7일 전 자정 직후, 서버가 이 규칙을 실제로 실행한 가장 최근 결과. */
export interface RecurringRuleLatestRun {
  target_date: string;
  status: RecurringRunStatus;
  booked_room_name: string | null;
  attempted_priority: number | null;
  failure_reason: string | null;
  executed_at: string;
}

export interface RecurringRule {
  id: string;
  /** 0=일요일 ... 6=토요일 */
  weekday: number;
  start_time: string;
  end_time: string;
  title: string;
  contents: string | null;
  is_active: boolean;
  rooms: RecurringRuleRoom[];
  latest_run: RecurringRuleLatestRun | null;
}

// POST /me/recurring-rules 요청 바디. room_ids 배열 순서 = 우선순위(1~3개).
export interface CreateRecurringRuleBody {
  weekday: number;
  start_time: string;
  end_time: string;
  title: string;
  contents?: string;
  room_ids: string[];
}

export interface CreateRecurringRuleResponse {
  id: string;
}

// GET /me/unattended-consent 응답. 이 동의가 있어야만 서버가 사용자 부재 중에도
// CJ WORLD 계정으로 대신 로그인해 반복 예약을 실행할 수 있다.
export interface UnattendedConsent {
  consented: boolean;
  consented_at: string | null;
}
