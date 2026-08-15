// orchestrator.ts 통합 유닛 테스트 -- OpenAI 호출(fetch)과 tools/* 전체를 페이크로
// 대체하고, BE-7의 핵심 안전장치("SaveReserve 직전 명시적 확인 없이는 실행되지 않음")가
// 실제 대화 루프 레벨에서도 지켜지는지 확인한다.
//
// 5-project-principle.md §4: CJ 자동화/DB 없이 입력→출력만 검증하면 되는 로직이므로
// tools/* 계층은 전부 vi.mock으로 스텁한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tools/availability.tool", () => ({
  findAvailableRooms: vi.fn(),
  listBookableRoomsForContext: vi.fn(async () => []),
  recommendRoomsForUser: vi.fn(),
}));
vi.mock("../../tools/reservation.tool", () => ({
  createReservation: vi.fn(),
  createSplitReservation: vi.fn(),
  planLongMeetingSegments: vi.fn(),
  ReservationConflictError: class ReservationConflictError extends Error {},
  SegmentReservationFailedError: class SegmentReservationFailedError extends Error {},
}));
vi.mock("../../tools/myReservations.tool", () => ({
  getMyReservations: vi.fn(),
}));
vi.mock("../../tools/modifyReservation.tool", () => ({
  modifyReservation: vi.fn(),
  resolveSingleReservationTarget: vi.fn(),
  SplitGroupModifyNotSupportedError: class SplitGroupModifyNotSupportedError extends Error {},
  ReservationModifyFailedError: class ReservationModifyFailedError extends Error {},
}));
vi.mock("../../tools/cancelReservation.tool", () => ({
  cancelReservation: vi.fn(),
  SplitGroupCancelScopeRequiredError: class SplitGroupCancelScopeRequiredError extends Error {},
  ReservationAlreadyCancelledError: class ReservationAlreadyCancelledError extends Error {},
}));
vi.mock("../../tools/reservationTargeting", () => ({
  AmbiguousReservationTargetError: class AmbiguousReservationTargetError extends Error {},
  ReservationNotFoundError: class ReservationNotFoundError extends Error {},
}));

// [2026-08-16] sessionStore.ts가 chatSessionRepository(DB)를 통해 세션을 로드/저장하도록
// 바뀌어서, 여기서도 실제 DB 대신 메모리 기반 페이크로 대체한다(sessionStore.test.ts와
// 같은 패턴).
const fakeSessionDb = new Map<string, unknown>();
vi.mock("../../db/repositories/chatSessionRepository", () => ({
  loadChatSessionState: vi.fn(async (userId: string) => fakeSessionDb.get(userId) ?? null),
  saveChatSessionState: vi.fn(async (userId: string, state: unknown) => {
    fakeSessionDb.set(userId, JSON.parse(JSON.stringify(state)));
  }),
}));

import { createReservation } from "../../tools/reservation.tool";
import { handleUserMessage } from "../orchestrator";

// businessRules.ts는 실제 모듈을 그대로 쓰므로(순수 함수, mock 불필요), 예약 가능
// 범위(오늘~7일 뒤) 검증을 통과하도록 "내일" 날짜를 테스트 실행 시점 기준으로 계산한다.
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SAMPLE_ROOM = {
  id: "room-1",
  roomCode: "4539",
  roomName: "3F-1",
  areaCode: "804",
  subAreaCode: "1128",
  floorLabel: "3F",
  capacity: 8,
};

/** OpenAI Chat Completions 응답 형태를 흉내낸다. */
function chatResponse(message: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason: "stop" }] }),
  };
}

function toolCallMessage(name: string, args: Record<string, unknown>) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

function textMessage(text: string) {
  return { role: "assistant", content: text };
}

describe("orchestrator.handleUserMessage -- 확정 실행 2단계 게이트", () => {
  beforeEach(() => {
    fakeSessionDb.clear();
    vi.clearAllMocks();
  });

  it("같은 턴 안에서 propose 직후 곧바로 confirm을 호출하면 실제 createReservation은 절대 실행되지 않는다", async () => {
    const fetchMock = vi
      .fn()
      // 1) 모델이 propose_create_reservation을 호출
      .mockResolvedValueOnce(
        chatResponse(
          toolCallMessage("propose_create_reservation", {
            title: "주간회의",
            contents: "주간회의",
            phoneNum: "",
            date: TOMORROW,
            startTime: "15:00",
            endTime: "16:00",
            room: SAMPLE_ROOM,
          })
        )
      )
      // 2) (실수로) 같은 턴 안에서 모델이 바로 confirm_create_reservation을 호출
      .mockResolvedValueOnce(
        chatResponse(toolCallMessage("confirm_create_reservation", { confirmationToken: "will-be-overwritten" }))
      )
      // 3) 서버가 거부 메시지를 도구 결과로 돌려주면, 모델이 최종 텍스트로 마무리
      .mockResolvedValueOnce(chatResponse(textMessage("네, 다음 메시지에서 다시 확인 부탁드립니다.")));

    vi.stubGlobal("fetch", fetchMock);

    const result = await handleUserMessage("user-1", "내일 오후 3시 3F-1 예약해줘");

    expect(createReservation).not.toHaveBeenCalled();
    expect(result.reply).toContain("다시 확인");

    vi.unstubAllGlobals();
  });

  it("다음 턴에서 올바른 confirmationToken으로 confirm하면 실제 createReservation이 정확히 그 파라미터로 실행된다", async () => {
    (createReservation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      reservationId: "res-1",
      roomName: "3F-1",
      startTime: "15:00",
      endTime: "16:00",
      cjSeq: "1001",
    });

    let capturedToken = "";

    const fetchMockTurn1 = vi
      .fn()
      .mockResolvedValueOnce(
        chatResponse(
          toolCallMessage("propose_create_reservation", {
            title: "주간회의",
            contents: "주간회의",
            phoneNum: "",
            date: TOMORROW,
            startTime: "15:00",
            endTime: "16:00",
            room: SAMPLE_ROOM,
          })
        )
      )
      .mockResolvedValueOnce(chatResponse(textMessage("3F-1 15:00~16:00으로 예약할까요?")));
    vi.stubGlobal("fetch", fetchMockTurn1);

    await handleUserMessage("user-2", "내일 오후 3시 3F-1 예약해줘");

    // 첫 턴에서 실제로는 아직 아무것도 확정되지 않았어야 한다.
    expect(createReservation).not.toHaveBeenCalled();

    // sessionStore 내부 상태에서 토큰을 꺼내는 대신, 두 번째 턴에서 모델이 그대로
    // "자기가 이전 도구 응답에서 받은" 토큰을 쓴다고 가정하고 시나리오를 구성한다 --
    // 실제로는 모델이 이전 tool 응답 content에서 읽어온 토큰을 그대로 재사용한다.
    // 여기서는 내부 sessionStore를 통해 그 토큰 값을 확보해 재사용한다.
    const { getOrCreateSession } = await import("../sessionStore");
    const session = await getOrCreateSession("user-2");
    capturedToken = session.pendingConfirmation?.token ?? "";
    expect(capturedToken).not.toBe("");

    const fetchMockTurn2 = vi
      .fn()
      .mockResolvedValueOnce(
        chatResponse(toolCallMessage("confirm_create_reservation", { confirmationToken: capturedToken }))
      )
      .mockResolvedValueOnce(chatResponse(textMessage("예약이 완료되었습니다.")));
    vi.stubGlobal("fetch", fetchMockTurn2);

    const result2 = await handleUserMessage("user-2", "네, 확정해주세요");

    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(createReservation).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({ title: "주간회의", startTime: "15:00", endTime: "16:00" })
    );
    expect(result2.reply).toContain("완료");

    vi.unstubAllGlobals();
  });
});
