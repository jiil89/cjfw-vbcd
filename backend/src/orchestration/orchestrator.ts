// [레이어 1] LLM 오케스트레이션 — 대화 루프, 도구 실행, 세션 상태 관리.
//
// 5-project-principle.md §2 (엄격히 지킴): 이 파일은 `../tools/*`만 import한다.
// `../db/*`, `../cj-automation/*`를 어떤 형태로도(값이든 타입이든) import하지 않는다.
// 회의실/예약 관련 필요한 값 타입은 구조적으로 호환되는 로컬 타입(RoomLike 등)을
// 다시 선언해서 쓴다 — nominal import 없이도 tools/ 함수에 그대로 전달 가능하다
// (TypeScript 구조적 타이핑).
//
// BE-7 완료조건 대응:
// - "SaveReserve 직전 명시적 확인 없이는 실행 불가": 실제 쓰기가 있는 4개 동작
//   (create/split/modify/cancel reservation)은 propose_*(제안, 부작용 없음)와
//   confirm_*(실행) 두 도구로 분리하고, confirm_*은 sessionStore.validatePendingConfirmation로
//   "직전 턴에 등록된 토큰과 정확히 일치"할 때만 실제 tools/ 함수를 호출한다.
// - "세션 상태가 대화록 텍스트가 아니라 서버 상태로 관리됨": sessionStore.ts의
//   OrchestrationSession(특히 pendingConfirmation)이 유일한 근거이며, 매 턴 시스템
//   프롬프트에도 명시적으로 주입한다(systemPrompt.ts pendingSection).

import { randomUUID } from "node:crypto";
import { config } from "../config/env";
import {
  appendMessage,
  getOrCreateSession,
  resetSession,
  setPendingConfirmation,
  validatePendingConfirmation,
  type OrchestrationSession,
  type PendingConfirmation,
  type StoredChatMessage,
} from "./sessionStore";
import { buildSystemPrompt, type RoomForPrompt } from "./systemPrompt";
import { toolSchemas, TOOL_NAMES } from "./toolSchemas";

import { findAvailableRooms, listBookableRoomsForContext, recommendRoomsForUser } from "../tools/availability.tool";
import {
  createReservation,
  createSplitReservation,
  planLongMeetingSegments,
  ReservationConflictError,
  SegmentReservationFailedError,
  type RoomedSegmentPlan,
} from "../tools/reservation.tool";
import { getMyReservations } from "../tools/myReservations.tool";
import {
  modifyReservation,
  resolveSingleReservationTarget,
  SplitGroupModifyNotSupportedError,
  ReservationModifyFailedError,
} from "../tools/modifyReservation.tool";
import {
  cancelReservation,
  SplitGroupCancelScopeRequiredError,
  ReservationAlreadyCancelledError,
} from "../tools/cancelReservation.tool";
import { AmbiguousReservationTargetError, ReservationNotFoundError } from "../tools/reservationTargeting";
import {
  assertValidReservationWindow,
  BusinessRuleViolationError,
  durationMinutes,
  FIXED_SITE,
  MAX_SINGLE_ROOM_MINUTES,
} from "../tools/businessRules";

// ---------------------------------------------------------------------------
// db/repositories/roomRepository.Room과 구조적으로 동일한 로컬 타입. import 없이도
// tools/ 함수(예: createReservation의 input.room: Room)에 그대로 전달 가능하다.
// ---------------------------------------------------------------------------
interface RoomLike {
  id: string;
  site: string;
  areaCode: string;
  subAreaCode: string;
  roomCode: string;
  roomName: string;
  floorLabel: string | null;
  capacity: number | null;
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RoomInputFromModel {
  id: string;
  roomCode: string;
  roomName: string;
  areaCode: string;
  subAreaCode: string;
  floorLabel?: string | null;
  capacity?: number | null;
}

function toRoomLike(input: RoomInputFromModel): RoomLike {
  const now = new Date().toISOString();
  return {
    id: input.id,
    site: FIXED_SITE,
    areaCode: input.areaCode,
    subAreaCode: input.subAreaCode,
    roomCode: input.roomCode,
    roomName: input.roomName,
    floorLabel: input.floorLabel ?? null,
    capacity: input.capacity ?? null,
    isBookable: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** 모델에 돌려줄 회의실 요약 — 토큰 절약을 위해 site/isBookable/createdAt/updatedAt은 뺀다. */
function toRoomSummary(room: RoomLike | { id: string; roomCode: string; roomName: string; areaCode: string; subAreaCode: string; floorLabel: string | null; capacity: number | null }) {
  return {
    id: room.id,
    roomCode: room.roomCode,
    roomName: room.roomName,
    areaCode: room.areaCode,
    subAreaCode: room.subAreaCode,
    floorLabel: room.floorLabel,
    capacity: room.capacity,
  };
}

// ---------------------------------------------------------------------------
// 회의실 목록 캐시 (시스템 프롬프트용) — 자주 안 바뀌는 데이터를 매 턴 DB까지
// 왕복하지 않도록 TTL 캐시를 둔다 (비용/효율 원칙).
// ---------------------------------------------------------------------------
const ROOM_CONTEXT_TTL_MS = 5 * 60 * 1000; // 5분
let roomContextCache: { rooms: RoomForPrompt[]; fetchedAt: number } | null = null;

async function getRoomContext(): Promise<RoomForPrompt[]> {
  const now = Date.now();
  if (roomContextCache && now - roomContextCache.fetchedAt < ROOM_CONTEXT_TTL_MS) {
    return roomContextCache.rooms;
  }
  try {
    const rooms = await listBookableRoomsForContext();
    const forPrompt: RoomForPrompt[] = rooms.map((room) => ({
      roomName: room.roomName,
      floorLabel: room.floorLabel,
      capacity: room.capacity,
    }));
    roomContextCache = { rooms: forPrompt, fetchedAt: now };
    return forPrompt;
  } catch (err) {
    console.error("[orchestration/orchestrator] 회의실 목록 조회 실패 (시스템 프롬프트에 목록 없이 진행)", err);
    return roomContextCache?.rooms ?? [];
  }
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions API 최소 타입 (SDK 미사용 — Node 18+ 전역 fetch 사용)
// ---------------------------------------------------------------------------
interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiRequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiChatCompletionResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason: string;
  }>;
  error?: { message: string };
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

async function callOpenAi(messages: OpenAiRequestMessage[]): Promise<OpenAiChatCompletionResponse["choices"][0]["message"]> {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages,
      tools: toolSchemas,
      tool_choice: "auto",
    }),
  });

  const body = (await response.json()) as OpenAiChatCompletionResponse;
  if (!response.ok) {
    throw new Error(`[orchestration/orchestrator] OpenAI API 오류(${response.status}): ${body.error?.message ?? "알 수 없는 오류"}`);
  }
  const message = body.choices?.[0]?.message;
  if (!message) {
    throw new Error("[orchestration/orchestrator] OpenAI 응답에 message가 없습니다.");
  }
  return message;
}

// ---------------------------------------------------------------------------
// 도구 실행 디스패처
// ---------------------------------------------------------------------------
interface ToolExecutionResult {
  content: unknown;
  /** 이 턴의 응답을 사용자에게 보낸 뒤 세션을 리셋해야 하면 true
   * (BE-7 요구사항: 예약 완료/취소 시 컨텍스트 리셋). */
  resetSessionAfterReply?: boolean;
}

function errorResult(message: string): ToolExecutionResult {
  return { content: { error: message } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function requireRoomInput(args: Record<string, unknown>, key: string): RoomInputFromModel | null {
  const raw = args[key];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.roomCode !== "string" ||
    typeof r.roomName !== "string" ||
    typeof r.areaCode !== "string" ||
    typeof r.subAreaCode !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    areaCode: r.areaCode,
    subAreaCode: r.subAreaCode,
    floorLabel: typeof r.floorLabel === "string" ? r.floorLabel : null,
    capacity: typeof r.capacity === "number" ? r.capacity : null,
  };
}

async function executeTool(
  session: OrchestrationSession,
  userId: string,
  name: string,
  argsRaw: unknown
): Promise<ToolExecutionResult> {
  const args = asRecord(argsRaw);

  try {
    switch (name) {
      case "check_availability": {
        const date = requireString(args, "date");
        const startTime = requireString(args, "startTime");
        const endTime = requireString(args, "endTime");
        if (!date || !startTime || !endTime) return errorResult("date/startTime/endTime은 필수입니다.");
        const minCapacity = typeof args.minCapacity === "number" ? args.minCapacity : undefined;
        const floorLabel = typeof args.floorLabel === "string" ? args.floorLabel : undefined;
        try {
          const result = await findAvailableRooms(userId, { date, startTime, endTime, minCapacity, floorLabel });
          return {
            content: {
              preferred: result.preferred.map(toRoomSummary),
              others: result.others.map(toRoomSummary),
            },
          };
        } catch (err) {
          if (err instanceof BusinessRuleViolationError) return errorResult(err.message);
          throw err;
        }
      }

      case "plan_long_meeting": {
        const date = requireString(args, "date");
        const startTime = requireString(args, "startTime");
        const endTime = requireString(args, "endTime");
        if (!date || !startTime || !endTime) return errorResult("date/startTime/endTime은 필수입니다.");
        const minCapacity = typeof args.minCapacity === "number" ? args.minCapacity : undefined;
        try {
          const plan = await planLongMeetingSegments(userId, { date, startTime, endTime, minCapacity });
          if (plan.unavailableReason) {
            return { content: { available: false, reason: plan.unavailableReason } };
          }
          return {
            content: {
              available: true,
              segments: plan.segments.map((s) => ({
                room: toRoomSummary(s.room),
                startTime: s.startTime,
                endTime: s.endTime,
              })),
            },
          };
        } catch (err) {
          if (err instanceof BusinessRuleViolationError) return errorResult(err.message);
          throw err;
        }
      }

      case "recommend_rooms": {
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const rooms = await recommendRoomsForUser(userId, limit);
        return { content: { rooms: rooms.map(toRoomSummary) } };
      }

      case "get_my_reservations": {
        const fromDate = requireString(args, "fromDate");
        const toDate = requireString(args, "toDate");
        if (!fromDate || !toDate) return errorResult("fromDate/toDate는 필수입니다.");
        const groups = await getMyReservations(userId, { fromDate, toDate });
        return { content: { groups } };
      }

      case "find_reservation_candidates": {
        const date = requireString(args, "date");
        if (!date) return errorResult("date는 필수입니다.");
        const startTime = typeof args.startTime === "string" ? args.startTime : undefined;
        const endTime = typeof args.endTime === "string" ? args.endTime : undefined;
        const roomName = typeof args.roomName === "string" ? args.roomName : undefined;
        try {
          const reservation = await resolveSingleReservationTarget(userId, { date, startTime, endTime, roomName });
          return {
            content: {
              status: "resolved",
              reservation: {
                reservationId: reservation.id,
                reservationRequestId: reservation.reservationRequestId,
                title: reservation.title,
                roomName: reservation.roomName,
                startAt: reservation.startAt,
                endAt: reservation.endAt,
              },
            },
          };
        } catch (err) {
          if (err instanceof ReservationNotFoundError) {
            return { content: { status: "not_found" } };
          }
          if (err instanceof AmbiguousReservationTargetError) {
            return {
              content: {
                status: "ambiguous",
                message: err.message,
                candidates: err.candidates.map((c) => ({
                  reservationId: c.id,
                  reservationRequestId: c.reservationRequestId,
                  title: c.title,
                  roomName: c.roomName,
                  startAt: c.startAt,
                  endAt: c.endAt,
                })),
              },
            };
          }
          throw err;
        }
      }

      // -----------------------------------------------------------------
      // propose_* — 부작용 없음. pendingConfirmation을 "이번 턴"에 등록한다.
      // (validatePendingConfirmation이 같은 턴 confirm을 거부하므로, 실제 실행은
      //  반드시 사용자의 다음 메시지 이후에만 가능하다.)
      // -----------------------------------------------------------------
      case "propose_create_reservation": {
        const title = requireString(args, "title");
        const contents = requireString(args, "contents") ?? "";
        const phoneNum = typeof args.phoneNum === "string" ? args.phoneNum : "";
        const date = requireString(args, "date");
        const startTime = requireString(args, "startTime");
        const endTime = requireString(args, "endTime");
        const room = requireRoomInput(args, "room");
        if (!title || !date || !startTime || !endTime || !room) {
          return errorResult("title/date/startTime/endTime/room은 필수입니다.");
        }
        try {
          assertValidReservationWindow({ date, today: new Date().toISOString().slice(0, 10), startTime, endTime });
          if (durationMinutes(startTime, endTime) > MAX_SINGLE_ROOM_MINUTES) {
            return errorResult(`${MAX_SINGLE_ROOM_MINUTES}분을 초과하는 요청은 plan_long_meeting으로 분할 계획을 먼저 세워야 합니다.`);
          }
        } catch (err) {
          if (err instanceof BusinessRuleViolationError) return errorResult(err.message);
          throw err;
        }

        const params = { title, contents, phoneNum, date, startTime, endTime, room: toRoomLike(room) };
        const summary = `${room.roomName} ${date} ${startTime}~${endTime} "${title}"`;
        const pending: PendingConfirmation = {
          token: randomUUID(),
          kind: "create_reservation",
          summary,
          params,
          createdAtTurn: session.turnIndex,
        };
        setPendingConfirmation(session, pending);
        return { content: { confirmationToken: pending.token, summary, requiresUserConfirmation: true } };
      }

      case "confirm_create_reservation": {
        const token = requireString(args, "confirmationToken");
        if (!token) return errorResult("confirmationToken은 필수입니다.");
        const check = validatePendingConfirmation(session, token, "create_reservation");
        if (!check.ok) return errorResult(check.reason);

        try {
          const result = await createReservation(
            userId,
            check.pending.params as Parameters<typeof createReservation>[1]
          );
          setPendingConfirmation(session, null);
          return { content: { status: "confirmed", reservation: result }, resetSessionAfterReply: true };
        } catch (err) {
          setPendingConfirmation(session, null);
          if (err instanceof ReservationConflictError || err instanceof BusinessRuleViolationError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "propose_split_reservation": {
        const title = requireString(args, "title");
        const contents = requireString(args, "contents") ?? "";
        const phoneNum = typeof args.phoneNum === "string" ? args.phoneNum : "";
        const date = requireString(args, "date");
        const planRaw = args.plan;
        if (!title || !date || !Array.isArray(planRaw) || planRaw.length < 2) {
          return errorResult("title/date/plan(2개 이상)은 필수입니다. plan_long_meeting 결과의 segments를 그대로 전달하세요.");
        }

        const plan: RoomedSegmentPlan[] = [];
        for (const rawSegment of planRaw) {
          const seg = asRecord(rawSegment);
          const room = requireRoomInput(seg, "room");
          const startTime = requireString(seg, "startTime");
          const endTime = requireString(seg, "endTime");
          if (!room || !startTime || !endTime) {
            return errorResult("plan의 각 항목은 room/startTime/endTime을 모두 포함해야 합니다.");
          }
          plan.push({ room: toRoomLike(room), startTime, endTime });
        }

        const summary = `${date} ` + plan.map((s) => `${s.room.roomName} ${s.startTime}~${s.endTime}`).join(" + ") + ` (총 ${plan.length}개 회의실) "${title}"`;
        const pending: PendingConfirmation = {
          token: randomUUID(),
          kind: "split_reservation",
          summary,
          params: { title, contents, phoneNum, date, plan },
          createdAtTurn: session.turnIndex,
        };
        setPendingConfirmation(session, pending);
        return { content: { confirmationToken: pending.token, summary, requiresUserConfirmation: true } };
      }

      case "confirm_split_reservation": {
        const token = requireString(args, "confirmationToken");
        if (!token) return errorResult("confirmationToken은 필수입니다.");
        const check = validatePendingConfirmation(session, token, "split_reservation");
        if (!check.ok) return errorResult(check.reason);

        try {
          const results = await createSplitReservation(
            userId,
            check.pending.params as Parameters<typeof createSplitReservation>[1]
          );
          setPendingConfirmation(session, null);
          return { content: { status: "confirmed", reservations: results }, resetSessionAfterReply: true };
        } catch (err) {
          setPendingConfirmation(session, null);
          if (err instanceof SegmentReservationFailedError) {
            return errorResult(err.message);
          }
          if (err instanceof BusinessRuleViolationError) return errorResult(err.message);
          throw err;
        }
      }

      case "propose_modify_reservation": {
        const reservationId = requireString(args, "reservationId");
        if (!reservationId) return errorResult("reservationId는 필수입니다.");
        const newRoomInput = args.newRoom ? requireRoomInput(args, "newRoom") : null;
        const newDate = typeof args.newDate === "string" ? args.newDate : undefined;
        const newStartTime = typeof args.newStartTime === "string" ? args.newStartTime : undefined;
        const newEndTime = typeof args.newEndTime === "string" ? args.newEndTime : undefined;

        const changeDescription = [
          newRoomInput ? `회의실→${newRoomInput.roomName}` : null,
          newDate ? `날짜→${newDate}` : null,
          newStartTime || newEndTime ? `시간→${newStartTime ?? "(기존)"}~${newEndTime ?? "(기존)"}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const summary = `예약(${reservationId}) 변경: ${changeDescription || "(변경 없음)"}`;

        const pending: PendingConfirmation = {
          token: randomUUID(),
          kind: "modify_reservation",
          summary,
          params: {
            reservationId,
            newRoom: newRoomInput ? toRoomLike(newRoomInput) : undefined,
            newDate,
            newStartTime,
            newEndTime,
          },
          createdAtTurn: session.turnIndex,
        };
        setPendingConfirmation(session, pending);
        return { content: { confirmationToken: pending.token, summary, requiresUserConfirmation: true } };
      }

      case "confirm_modify_reservation": {
        const token = requireString(args, "confirmationToken");
        if (!token) return errorResult("confirmationToken은 필수입니다.");
        const check = validatePendingConfirmation(session, token, "modify_reservation");
        if (!check.ok) return errorResult(check.reason);

        try {
          const result = await modifyReservation(
            userId,
            check.pending.params as Parameters<typeof modifyReservation>[1]
          );
          setPendingConfirmation(session, null);
          return { content: { status: "confirmed", reservation: result } };
        } catch (err) {
          setPendingConfirmation(session, null);
          if (
            err instanceof ReservationNotFoundError ||
            err instanceof SplitGroupModifyNotSupportedError ||
            err instanceof ReservationModifyFailedError ||
            err instanceof ReservationConflictError ||
            err instanceof BusinessRuleViolationError
          ) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "propose_cancel_reservation": {
        const reservationId = requireString(args, "reservationId");
        if (!reservationId) return errorResult("reservationId는 필수입니다.");
        const scopeRaw = args.scope;
        const scope = scopeRaw === "single" || scopeRaw === "entire_group" ? scopeRaw : undefined;

        const summary = `예약(${reservationId}) 취소${scope ? ` (범위: ${scope === "entire_group" ? "전체" : "이 구간만"})` : ""}`;
        const pending: PendingConfirmation = {
          token: randomUUID(),
          kind: "cancel_reservation",
          summary,
          params: { reservationId, scope },
          createdAtTurn: session.turnIndex,
        };
        setPendingConfirmation(session, pending);
        return { content: { confirmationToken: pending.token, summary, requiresUserConfirmation: true } };
      }

      case "confirm_cancel_reservation": {
        const token = requireString(args, "confirmationToken");
        if (!token) return errorResult("confirmationToken은 필수입니다.");
        const check = validatePendingConfirmation(session, token, "cancel_reservation");
        if (!check.ok) return errorResult(check.reason);

        try {
          const results = await cancelReservation(
            userId,
            check.pending.params as Parameters<typeof cancelReservation>[1]
          );
          setPendingConfirmation(session, null);
          return { content: { status: "confirmed", cancelled: results }, resetSessionAfterReply: true };
        } catch (err) {
          setPendingConfirmation(session, null);
          if (err instanceof SplitGroupCancelScopeRequiredError) {
            // 도메인 정의서 2번: 기본값을 임의로 정하지 않는다 — 아직 아무것도 취소되지
            // 않았으므로(파일 상단 설계 노트 참고) 사용자에게 되묻도록 안내만 반환한다.
            return {
              content: {
                status: "scope_required",
                message: err.message,
                segments: err.groupSegments.map((s) => ({
                  reservationId: s.id,
                  roomId: s.roomId,
                  startAt: s.startAt,
                  endAt: s.endAt,
                })),
              },
            };
          }
          if (err instanceof ReservationNotFoundError || err instanceof ReservationAlreadyCancelledError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      default:
        return errorResult(`알 수 없는 도구입니다: ${name}`);
    }
  } catch (err) {
    console.error(`[orchestration/orchestrator] 도구 실행 중 예상하지 못한 오류: ${name}`, err);
    return errorResult(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
  }
}

// ---------------------------------------------------------------------------
// 대화 루프
// ---------------------------------------------------------------------------
const MAX_TOOL_ITERATIONS = 6;

export interface OrchestratorReply {
  reply: string;
}

/**
 * 사용자 메시지 1건을 처리한다. 세션 상태(userId 기준)는 sessionStore가 관리하며,
 * 이 함수는 그 상태를 읽고 갱신할 뿐 자체적으로 전역 상태를 만들지 않는다.
 */
export async function handleUserMessage(userId: string, userMessage: string): Promise<OrchestratorReply> {
  const session = getOrCreateSession(userId);
  session.turnIndex += 1;

  appendMessage(session, { role: "user", content: userMessage });

  const rooms = await getRoomContext();
  const today = new Date().toISOString().slice(0, 10);

  let resetAfterReply = false;
  let finalReply: string | null = null;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const systemPrompt = buildSystemPrompt({
      today,
      rooms,
      pendingConfirmation: session.pendingConfirmation
        ? { kind: session.pendingConfirmation.kind, token: session.pendingConfirmation.token, summary: session.pendingConfirmation.summary }
        : null,
    });

    const messages: OpenAiRequestMessage[] = [
      { role: "system", content: systemPrompt },
      ...session.messages.map((m): OpenAiRequestMessage => ({
        role: m.role,
        content: m.content,
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
      })),
    ];

    const assistantMessage = await callOpenAi(messages);

    const storedAssistantMessage: StoredChatMessage = {
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    };
    appendMessage(session, storedAssistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalReply = assistantMessage.content ?? "";
      break;
    }

    // 모델이 알려주지 않은/스키마에 없는 도구 이름을 부르는 경우를 방어한다.
    for (const toolCall of assistantMessage.tool_calls) {
      const name = toolCall.function.name;
      let args: unknown = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch {
        appendMessage(session, {
          role: "tool",
          tool_call_id: toolCall.id,
          name,
          content: JSON.stringify({ error: "도구 인자 JSON 파싱에 실패했습니다. 올바른 JSON으로 다시 시도하세요." }),
        });
        continue;
      }

      if (!TOOL_NAMES.includes(name)) {
        appendMessage(session, {
          role: "tool",
          tool_call_id: toolCall.id,
          name,
          content: JSON.stringify({ error: `정의되지 않은 도구입니다: ${name}` }),
        });
        continue;
      }

      const result = await executeTool(session, userId, name, args);
      if (result.resetSessionAfterReply) {
        resetAfterReply = true;
      }
      appendMessage(session, {
        role: "tool",
        tool_call_id: toolCall.id,
        name,
        content: JSON.stringify(result.content),
      });
    }
  }

  if (finalReply === null) {
    finalReply = "요청을 처리하는 데 시간이 걸리고 있습니다. 조금 더 구체적으로 다시 말씀해 주시겠어요?";
    console.warn(`[orchestration/orchestrator] 도구 호출 루프가 ${MAX_TOOL_ITERATIONS}회를 넘어 강제 종료됨 (userId=${userId})`);
  }

  if (resetAfterReply) {
    // 도메인 정의서 2번 "긴 회의 요청"/"내 예약 조회" 등에서 예약 완료·취소는 하나의
    // 용건이 끝났다는 신호다 — BE-7 요구사항대로 다음 턴부터는 새 컨텍스트로 시작한다.
    resetSession(userId);
  }

  return { reply: finalReply };
}
