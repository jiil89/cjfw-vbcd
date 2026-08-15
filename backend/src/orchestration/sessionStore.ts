// [레이어 1] LLM 오케스트레이션 — 서버 측 세션 상태 관리.
//
// BE-7 완료조건: "세션 상태(진행 중인 예약 등)가 대화록 텍스트가 아니라 서버 상태로
// 관리됨". 이 파일은 사용자별 대화 히스토리(비용 절감을 위해 개수 제한)와, 예약
// 확정 전 필수로 거쳐야 하는 "확인 대기(pendingConfirmation)" 상태를 관리한다 —
// LLM이 스스로 "확인했다"고 주장하는 텍스트를 신뢰하지 않고, 이 객체의 존재/일치
// 여부로만 확정 실행을 허용한다 (orchestrator.ts에서 강제).
//
// [2026-08-16 변경] 원래는 모듈 전역 `Map`(순수 메모리)이었는데, Vercel 서버리스에서는
// 함수 인스턴스가 바뀌면 그 메모리가 통째로 사라져 대화 기억이 유실된다(로컬은 프로세스가
// 계속 떠있어 이 문제가 절대 드러나지 않았다). 그래서 턴 시작 시 DB에서 로드하고 턴이
// 끝날 때 DB에 저장하는 방식으로 바꿨다 — 상태를 들고 있는 필드/판정 로직(§ 아래 함수들)은
// 전부 그대로고, "어디에 보관하느냐"만 바뀐다.
//
// [의도된 예외] 이 파일은 `db/repositories/chatSessionRepository`를 직접 부른다 —
// `orchestration → tools → db` 의존 방향(5-project-principle.md §2)을 우회하는 것처럼
// 보이지만, 이건 예약 비즈니스 로직이 아니라 오케스트레이션 자신의 상태를 어디에
// 영속화할지 정하는 순수 인프라 관심사라 tools/에 억지로 끼워넣지 않는다(로그인 시
// CJ 세션을 예열하는 auth.routes.ts의 기존 예외와 같은 성격).
// 세션의 "판정 로직"(validatePendingConfirmation, wasSlotOfferedBefore 등)은 여전히
// 순수 함수라 DB/네트워크 없이 유닛 테스트할 수 있다 — DB를 만지는 건 로드/저장 두
// 함수(getOrCreateSession, saveSession)뿐이다.

import { loadChatSessionState, saveChatSessionState } from "../db/repositories/chatSessionRepository";

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

/** check_availability로 사용자에게 실제로 보여준 "예약 가능 슬롯". 사용자가 목록에서
 * 하나를 고르면 그건 이미 명시적 선택이므로 확인 버튼을 한 번 더 누르게 하지 않는데,
 * 그 판정을 LLM의 주장이 아니라 이 서버 기록으로만 한다. */
export interface OfferedSlot {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface OrchestrationSession {
  userId: string;
  messages: StoredChatMessage[];
  pendingConfirmation: PendingConfirmation | null;
  /** 직전에 사용자에게 보여준 슬롯 목록과, 그걸 보여준 turnIndex. */
  offeredSlots: OfferedSlot[];
  offeredSlotsTurn: number;
  /** find_reservation_candidates가 "후보 정확히 1건"으로 확정한 예약 id.
   * 변경/취소 대상이 서버 기준으로 유일하다는 증거로만 쓴다. */
  resolvedTargetReservationId: string | null;
  turnIndex: number;
  createdAt: number;
  lastActivityAt: number;
}

/** 대화 이력은 비용/효율을 위해 이 개수(메시지 기준)를 넘으면 오래된 것부터 잘라낸다.
 * pendingConfirmation은 별도 필드로 관리되므로 히스토리를 잘라내도 유실되지 않는다. */
const MAX_HISTORY_MESSAGES = 20;

/** 무응답이 이 시간(ms) 이상 지속되면 다음 요청 처리 전에 세션을 리셋한다. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분

function createEmptySession(userId: string): OrchestrationSession {
  const now = Date.now();
  return {
    userId,
    messages: [],
    pendingConfirmation: null,
    offeredSlots: [],
    offeredSlotsTurn: -1,
    resolvedTargetReservationId: null,
    turnIndex: 0,
    createdAt: now,
    lastActivityAt: now,
  };
}

/** DB에서 읽어온 값은 구조적으로 신뢰하지 않는다 — 필드가 없거나(마이그레이션 전 데이터,
 * 수동 조작 등) 타입이 안 맞으면 빈 세션으로 취급한다. 이 정도만 확인하고 나머지는
 * OrchestrationSession으로 그대로 캐스팅한다(JSON 스키마 검증 라이브러리까지는 과함 —
 * 이 값은 우리 서버가 쓴 것만 다시 읽는 내부 상태라 신뢰 수준이 사용자 입력과 다르다). */
function isPlausibleSessionState(value: unknown): value is OrchestrationSession {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { messages?: unknown }).messages) &&
    typeof (value as { turnIndex?: unknown }).turnIndex === "number"
  );
}

/** userId를 세션 키로 사용한다 — 이 서비스는 사용자당 챗봇 대화가 1개뿐이라는 전제
 * (도메인 정의서 1번: 1차 채널은 웹 챗봇 하나) 하에 오버엔지니어링을 피한 단순한 설계다. */
export async function getOrCreateSession(userId: string): Promise<OrchestrationSession> {
  const raw = await loadChatSessionState(userId);
  const loaded = isPlausibleSessionState(raw) ? raw : null;

  if (!loaded) {
    return createEmptySession(userId);
  }

  const idleMs = Date.now() - loaded.lastActivityAt;
  if (idleMs > SESSION_TIMEOUT_MS) {
    return createEmptySession(userId);
  }

  return loaded;
}

/** 이번 턴에 바뀐 세션을 저장한다. 턴 안에서의 각 mutate(appendMessage 등)는 메모리
 * 객체를 그대로 조작할 뿐이고, 실제 영속화는 턴이 끝날 때 이 함수 호출 한 번으로
 * 끝낸다 — 매 mutate마다 DB를 치지 않는다. */
export async function saveSession(session: OrchestrationSession): Promise<void> {
  await saveChatSessionState(session.userId, session, new Date(session.lastActivityAt));
}

/** 예약 완료/취소 등 "이번 용건이 끝났다"고 판단되는 시점에 컨텍스트를 리셋한다
 * (BE-7 요구사항: 예약 완료/취소 또는 무응답 타임아웃 시 컨텍스트 리셋). */
export async function resetSession(userId: string): Promise<OrchestrationSession> {
  const fresh = createEmptySession(userId);
  await saveSession(fresh);
  return fresh;
}

export function appendMessage(session: OrchestrationSession, message: StoredChatMessage): void {
  session.messages.push(message);
  if (session.messages.length > MAX_HISTORY_MESSAGES) {
    let cutIndex = session.messages.length - MAX_HISTORY_MESSAGES;
    // [2026-08-14 실사용 검증에서 발견] "tool" 역할 메시지는 반드시 그 직전의
    // tool_calls를 포함한 assistant 메시지와 붙어있어야 OpenAI API가 허용한다
    // ("messages with role 'tool' must be a response to a preceeding message with
    // 'tool_calls'"). 단순 개수 기준으로 자르면 이 자름 지점이 tool 메시지 한가운데
    // 걸려서 그 assistant 메시지는 잘려나가고 tool 응답만 배열 맨 앞에 고아로
    // 남는 경우가 실제로 재현됐다(대화가 길어질 때마다 이후 모든 턴이 400으로
    // 계속 실패하는 심각한 버그였음) — 자름 지점이 tool 메시지를 가리키면 그
    // 그룹 전체를 건너뛴다.
    while (cutIndex < session.messages.length && session.messages[cutIndex].role === "tool") {
      cutIndex += 1;
    }
    session.messages.splice(0, cutIndex);
  }
  session.lastActivityAt = Date.now();
}

export function setPendingConfirmation(
  session: OrchestrationSession,
  pending: PendingConfirmation | null
): void {
  session.pendingConfirmation = pending;
}

export function setOfferedSlots(session: OrchestrationSession, slots: OfferedSlot[]): void {
  session.offeredSlots = slots;
  session.offeredSlotsTurn = session.turnIndex;
}

/**
 * 이 슬롯이 "사용자가 이전 턴에 실제로 보고 나서 고른 것"인지 판정한다.
 * 이전 턴(offeredSlotsTurn < turnIndex)이어야 한다는 조건이 핵심이다 — 같은 턴에
 * 조회하고 곧바로 예약하면 사용자는 목록을 본 적조차 없으므로 선택으로 볼 수 없다.
 */
export function wasSlotOfferedBefore(session: OrchestrationSession, slot: OfferedSlot): boolean {
  if (session.offeredSlotsTurn >= session.turnIndex) return false;
  return session.offeredSlots.some(
    (offered) =>
      offered.roomId === slot.roomId &&
      offered.date === slot.date &&
      offered.startTime === slot.startTime &&
      offered.endTime === slot.endTime
  );
}

export function setResolvedTarget(session: OrchestrationSession, reservationId: string | null): void {
  session.resolvedTargetReservationId = reservationId;
}

/** 변경/취소 대상이 서버가 직접 "후보 1건"으로 좁힌 그 예약과 동일한지. */
export function isResolvedTarget(session: OrchestrationSession, reservationId: string): boolean {
  return session.resolvedTargetReservationId === reservationId;
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
