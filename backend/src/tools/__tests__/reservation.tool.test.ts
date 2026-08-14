// reservation.tool.ts 유닛 테스트.
// 5-project-principle.md 4번: CJ 자동화/DB는 실제로 호출하지 않고 모듈을 페이크로
// 대체한다(vi.mock). BE-6 완료조건 중 "세그먼트 분할" + "부분 실패 보상 트랜잭션"을
// 여기서 증명한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cj-automation/client", () => ({
  checkRoom: vi.fn(),
  checkStraightRoom: vi.fn(),
  checkDayCountLimit: vi.fn(),
  saveReserve: vi.fn(),
  delReserve: vi.fn(),
}));
vi.mock("../../cj-automation/session", () => ({
  getValidSession: vi.fn(async () => ({ cookieHeader: "fake", baseUrl: "https://example.test" })),
}));
vi.mock("../../db/repositories/reservationRepository", () => ({
  createReservation: vi.fn(),
  RoomAlreadyBookedError: class RoomAlreadyBookedError extends Error {},
}));
vi.mock("../../db/repositories/reservationRequestRepository", () => ({
  createReservationRequest: vi.fn(async () => ({ id: "request-1" })),
  linkReservationRequestToReservation: vi.fn(),
}));
vi.mock("../../db/repositories/userRepository", () => ({
  findUserById: vi.fn(async () => ({ id: "user-1", emailAlias: "tester" })),
}));

import { checkDayCountLimit, checkRoom, checkStraightRoom, delReserve, saveReserve } from "../../cj-automation/client";
import { createReservation as insertReservationRow } from "../../db/repositories/reservationRepository";
import type { Room } from "../../db/repositories/roomRepository";
import {
  buildSegmentTimeWindows,
  createSplitReservation,
  SegmentReservationFailedError,
  splitIntoSegments,
} from "../reservation.tool";

function makeRoom(overrides: Partial<Room>): Room {
  return {
    id: overrides.id ?? "room-id",
    site: "상암S시티",
    areaCode: "804",
    subAreaCode: "1128",
    roomCode: overrides.roomCode ?? "3F-1",
    roomName: overrides.roomName ?? "3F-1",
    floorLabel: overrides.floorLabel ?? "3F",
    capacity: 8,
    isBookable: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("splitIntoSegments -- 2시간 초과 요청 분할 (도메인 정의서 2번)", () => {
  it("180분(3시간)을 앞쪽부터 120분씩 채우고 나머지를 마지막에 배정한다", () => {
    expect(splitIntoSegments(180)).toEqual([120, 60]);
  });

  it("300분(5시간)을 앞쪽부터 120분씩 채우고 나머지를 마지막에 배정한다", () => {
    expect(splitIntoSegments(300)).toEqual([120, 120, 60]);
  });

  it("240분(4시간)을 ceil(240/120)=2개, 120분씩 정확히 균등 분할한다", () => {
    expect(splitIntoSegments(240)).toEqual([120, 120]);
  });

  it("120분 이하는 애초에 이 함수의 대상이 아니므로 세그먼트 1개로 그대로 반환한다", () => {
    expect(splitIntoSegments(90)).toEqual([90]);
  });

  it("30분 단위가 아니거나 0 이하이면 에러를 던진다", () => {
    expect(() => splitIntoSegments(100)).toThrow();
    expect(() => splitIntoSegments(0)).toThrow();
    expect(() => splitIntoSegments(-30)).toThrow();
  });
});

describe("buildSegmentTimeWindows", () => {
  it("14:00 시작으로 [90, 90]을 연속된 시간창으로 펼친다", () => {
    expect(buildSegmentTimeWindows("14:00", [90, 90])).toEqual([
      { startTime: "14:00", endTime: "15:30" },
      { startTime: "15:30", endTime: "17:00" },
    ]);
  });
});

describe("createSplitReservation -- 부분 실패 시 보상 트랜잭션 (BE-6 완료조건)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkRoom as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (checkStraightRoom as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (checkDayCountLimit as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it("모든 세그먼트가 성공하면 각각 DB에 저장되고 delReserve는 호출되지 않는다", async () => {
    (saveReserve as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ Result: "1", seq: "1001" })
      .mockResolvedValueOnce({ Result: "1", seq: "1002" });
    (insertReservationRow as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "res-1" })
      .mockResolvedValueOnce({ id: "res-2" });

    const plan = [
      { startTime: "14:00", endTime: "15:30", room: makeRoom({ id: "room-a", roomCode: "3F-1" }) },
      { startTime: "15:30", endTime: "17:00", room: makeRoom({ id: "room-b", roomCode: "3F-2" }) },
    ];

    const result = await createSplitReservation("user-1", {
      title: "긴 회의",
      contents: "내용",
      phoneNum: "010-0000-0000",
      date: "2026-08-14",
      plan,
    }, "2026-08-13");

    expect(result).toHaveLength(2);
    expect(delReserve).not.toHaveBeenCalled();
  });

  it("두 번째 세그먼트가 실패하면 첫 번째 세그먼트를 delReserve로 자동 취소하고 예외를 던진다", async () => {
    (saveReserve as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ Result: "1", seq: "1001" }) // 첫 세그먼트 SaveReserve 성공
      .mockRejectedValueOnce(new Error("CJ 쪽에서 다른 사람이 선점")); // 두 번째 세그먼트 실패
    (insertReservationRow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "res-1" });
    (delReserve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const plan = [
      { startTime: "14:00", endTime: "15:30", room: makeRoom({ id: "room-a", roomCode: "3F-1" }) },
      { startTime: "15:30", endTime: "17:00", room: makeRoom({ id: "room-b", roomCode: "3F-2" }) },
    ];

    await expect(
      createSplitReservation(
        "user-1",
        { title: "긴 회의", contents: "내용", phoneNum: "010-0000-0000", date: "2026-08-14", plan },
        "2026-08-13"
      )
    ).rejects.toBeInstanceOf(SegmentReservationFailedError);

    // 첫 번째 세그먼트에서 만든 CJ 예약(seq=1001)이 보상 취소됐는지 확인 (BE-6 완료조건 핵심).
    expect(delReserve).toHaveBeenCalledTimes(1);
    expect(delReserve).toHaveBeenCalledWith(expect.anything(), "1001");
    // 두 번째 세그먼트는 실패했으므로 DB에는 1건만 저장된다.
    expect(insertReservationRow).toHaveBeenCalledTimes(1);
  });

  it("DB 저장(reservations_no_overlap 등)이 실패해도 이미 만든 CJ 세그먼트들을 보상 취소한다", async () => {
    (saveReserve as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ Result: "1", seq: "2001" })
      .mockResolvedValueOnce({ Result: "1", seq: "2002" });
    (insertReservationRow as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "res-1" })
      .mockRejectedValueOnce(new Error("DB insert failed"));
    (delReserve as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const plan = [
      { startTime: "14:00", endTime: "15:30", room: makeRoom({ id: "room-a", roomCode: "3F-1" }) },
      { startTime: "15:30", endTime: "17:00", room: makeRoom({ id: "room-b", roomCode: "3F-2" }) },
    ];

    await expect(
      createSplitReservation(
        "user-1",
        { title: "긴 회의", contents: "내용", phoneNum: "010-0000-0000", date: "2026-08-14", plan },
        "2026-08-13"
      )
    ).rejects.toBeInstanceOf(SegmentReservationFailedError);

    expect(delReserve).toHaveBeenCalledTimes(2);
    expect(delReserve).toHaveBeenCalledWith(expect.anything(), "2001");
    expect(delReserve).toHaveBeenCalledWith(expect.anything(), "2002");
  });
});
