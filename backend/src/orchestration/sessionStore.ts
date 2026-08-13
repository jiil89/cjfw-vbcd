// [레이어 1] LLM 오케스트레이션 — 서버 측 세션 상태 관리.
//
// BE-7 완료조건: "세션 상태(진행 중인 예약 등)가 대화록 텍스트가 아니라 서버 상태로
// 관리됨". 이 파일은 사용자별 대화 히스토리(비용 절감을 위해 개수 제한)와, 예약
// 확정 전 필수로 거쳐야 하는 "확인 대기(pendingConfirmation)" 상태를 순수 서버
// 메모리 객체로 관리한다 — LLM이 스스로 "확인했다"고 주장하는 텍스트를 신뢰하지 않고,
// 이 객체의 존재/일치 여부로만 확정 실행을 허용한다 (orchestrator.ts에서 강제).
//
// 이 파일은 다른 어떤 계층도 의존하지 않는 순수 상태 저장소다 (tools/db/cj-automation
// 전혀 모름) — 유닛 테스트로 검증 가능하다.

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** OpenAI Chat Completions 메시지 형식과 호환되는 최소 구조. */
export interface StoredChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/**
 * 예약 확정/변경/취소 직전 "제안(propose)" 단계에서 등록되는 확인 대기 상태.
 * params는 사용자에게 보여준 제안 그대로를 서버가 들고 있다가, confirm 시점에
 * 그대로 재사용한다 — LLM이 confirm 호출 시 파라미터를 다시 지어내지 못하게 막는다.
 */
export interface PendingConfirmation {
  token: string;
  /** confirm_create_reservation | confirm_split_reservation | confirm_modify_reservation | confirm_cancel_reservation */
  kind: "create_reservation" | "split_reservation" | "modify_reservation" | "cancel_reservation";
  /** 사용자에게 보여준 요약 문구 (시스템 프롬프트에 그대로 다시 주입해 컨텍스트 유지) */
  summary: string;
  /** 실행 시 그대로 사용할 파라미터. 도구별로 형태가 다르므로 unknown으로 둔다 —
   * 실제 사용 지점(orchestrator.ts)에서만 좁은 타입으로 캐스팅한다. */
  params: unknown;
  /** 이 제안이 등록된 turnIndex. 같은 턴 안에서는 confirm을 허용하지 않는다
   * (propose 직후 곧바로 confirm하는 실수/편법 방지 — 반드시 사용자의 다음 메시지를 거쳐야 함). */
  createdAtTurn: number;
}

export interface OrchestrationSession {
  userId: string;
  messages: StoredChatMessage[];
  pendingConfirmation: PendingConfirmation | null;
  turnIndex: number;
  createdAt: number;
  lastActivityAt: number;
}

/** 대화 이력은 비용/효율을 위해 이 개수(메시지 기준)를 넘으면 오래된 것부터 잘라낸다.
 * pendingConfirmation은 별도 필드로 관리되므로 히스토리를 잘라내도 유실되지 않는다. */
const MAX_HISTORY_MESSAGES = 20;

/** 무응답이 이 시간(ms) 이상 지속되면 다음 요청 처리 전에 세션을 리셋한다. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분

const sessions = new Map<string, OrchestrationSession>();

function createEmptySession(userId: string): OrchestrationSession {
  const now = Date.now();
  return {
    userId,
    messages: [],
    pendingConfirmation: null,
    turnIndex: 0,
    createdAt: now,
    lastActivityAt: now,
  };
}

/** userId를 세션 키로 사용한다 — 이 서비스는 사용자당 챗봇 대화가 1개뿐이라는 전제
 * (도메인 정의서 1번: 1차 채널은 웹 챗봇 하나) 하에 오버엔지니어링을 피한 단순한 설계다. */
export function getOrCreateSession(userId: string): OrchestrationSession {
  const existing = sessions.get(userId);
  if (!existing) {
    const created = createEmptySession(userId);
    sessions.set(userId, created);
    return created;
  }

  const idleMs = Date.now() - existing.lastActivityAt;
  if (idleMs > SESSION_TIMEOUT_MS) {
    const fresh = createEmptySession(userId);
    sessions.set(userId, fresh);
    return fresh;
  }

  return existing;
}

/** 예약 완료/취소 등 "이번 용건이 끝났다"고 판단되는 시점에 컨텍스트를 리셋한다
 * (BE-7 요구사항: 예약 완료/취소 또는 무응답 타임아웃 시 컨텍스트 리셋). */
export function resetSession(userId: string): OrchestrationSession {
  const fresh = createEmptySession(userId);
  sessions.set(userId, fresh);
  return fresh;
}

export function appendMessage(session: OrchestrationSession, message: StoredChatMessage): void {
  session.messages.push(message);
  if (session.messages.length > MAX_HISTORY_MESSAGES) {
    session.messages.splice(0, session.messages.length - MAX_HISTORY_MESSAGES);
  }
  session.lastActivityAt = Date.now();
}

export function setPendingConfirmation(
  session: OrchestrationSession,
  pending: PendingConfirmation | null
): void {
  session.pendingConfirmation = pending;
}

/**
 * confirm_* 도구 호출 시 토큰을 검증한다. 다음 조건을 모두 만족해야 통과한다:
 * 1. pendingConfirmation이 존재한다.
 * 2. token이 정확히 일치한다.
 * 3. kind가 일치한다 (엉뚱한 종류의 확정 도구를 호출하지 못하게 막음).
 * 4. pendingConfirmation이 "이전 턴"에 등록된 것이어야 한다 — 같은 턴에서 propose 후
 *    바로 confirm하는 것은 거부한다(사용자의 실제 다음 메시지=명시적 동의를 강제).
 */
export function validatePendingConfirmation(
  session: OrchestrationSession,
  token: string,
  kind: PendingConfirmation["kind"]
): { ok: true; pending: PendingConfirmation } | { ok: false; reason: string } {
  const pending = session.pendingConfirmation;
  if (!pending) {
    return { ok: false, reason: "확인 대기 중인 제안이 없습니다. 먼저 propose_* 도구로 제안한 뒤 사용자 동의를 받으세요." };
  }
  if (pending.token !== token) {
    return { ok: false, reason: "confirmationToken이 일치하지 않습니다. 가장 최근 제안의 토큰을 사용하세요." };
  }
  if (pending.kind !== kind) {
    return { ok: false, reason: `이 토큰은 ${pending.kind} 제안용입니다. ${kind} 확정에는 사용할 수 없습니다.` };
  }
  if (pending.createdAtTurn >= session.turnIndex) {
    return {
      ok: false,
      reason: "같은 턴에서 제안 직후 바로 확정할 수 없습니다. 사용자의 다음 메시지로 명시적 동의를 받은 뒤 다시 시도하세요.",
    };
  }
  return { ok: true, pending };
}

/** 테스트 전용 — 모듈 전역 Map을 초기화한다. */
export function __resetAllSessionsForTest(): void {
  sessions.clear();
}
