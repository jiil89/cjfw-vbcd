// cancelReservation.tool.ts 유닛 테스트.
// BE-6 완료조건: 분할 예약(긴 회의) 그룹은 "전체 취소/일부만 취소"를 명시하지 않으면
// 기본값을 임의로 정하지 않고 명확한 오류로 되묻는다 (도메인 정의서 2번 "예약 취소" 3단계).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cj-automation/client", () => ({ delReserve: vi.fn() }));
vi.mock("../../cj-automation/session", () => ({
  getValidSession: vi.fn(async () => ({ cookieHeader: "fake", baseUrl: "https://example.test" })),
}));
vi.mock("../../db/repositories/reservationRepository", () => ({
  cancelReservationById: vi.fn(),
  findReservationById: vi.fn(),
  findReservationsByRequestId: vi.fn(),
}));

import { delReserve } from "../../cj-automation/client";
import {
  cancelReservationById,
  findReservationById,
  findReservationsByRequestId,
} from "../../db/repositories/reservationRepository";
import { cancelReservation, SplitGroupCancelScopeRequiredError } from "../cancelReservation.tool";

function makeReservation(overrides: Record<string, unknown>) {
  return {
    id: "res-1",
    reservationRequestId: null,
    userId: "user-1",
    roomId: "room-1",
    cjSeq: "1001",
    title: "회의",
    contents: null,
    startAt: "2026-08-14T15:00:00",
    endAt: "2026-08-14T16:00:00",
    status: "confirmed",
    createdAt: "2026-08-13T00:00:00",
    updatedAt: "2026-08-13T00:00:00",
    ...overrides,
  };
}

describe("cancelReservation -- 분할 예약 그룹 취소 범위 확인", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("단일 예약(분할 아님)은 scope 없이 바로 취소된다", async () => {
    (findReservationById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeReservation({ id: "res-1", reservationRequestId: null })
    );

    const result = await cancelReservation("user-1", { reservationId: "res-1" });
    expect(result).toHaveLength(1);
    expect(delReserve).toHaveBeenCalledWith(expect.anything(), "1001");
    expect(cancelReservationById).toHaveBeenCalledWith("res-1");
  });

  it("분할 예약 그룹인데 scope를 지정하지 않으면 SplitGroupCancelScopeRequiredError로 되묻는다", async () => {
    (findReservationById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeReservation({ id: "res-1", reservationRequestId: "req-1" })
    );
    (findReservationsByRequestId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1", reservationRequestId: "req-1" }),
      makeReservation({ id: "res-2", reservationRequestId: "req-1", cjSeq: "1002" }),
    ]);

    await expect(cancelReservation("user-1", { reservationId: "res-1" })).rejects.toBeInstanceOf(
      SplitGroupCancelScopeRequiredError
    );
    expect(cancelReservationById).not.toHaveBeenCalled();
    expect(delReserve).not.toHaveBeenCalled();
  });

  it("scope='entire_group'이면 그룹 전체를 취소한다", async () => {
    (findReservationById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeReservation({ id: "res-1", reservationRequestId: "req-1" })
    );
    (findReservationsByRequestId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1", reservationRequestId: "req-1", cjSeq: "1001" }),
      makeReservation({ id: "res-2", reservationRequestId: "req-1", cjSeq: "1002" }),
    ]);

    const result = await cancelReservation("user-1", { reservationId: "res-1", scope: "entire_group" });
    expect(result).toHaveLength(2);
    expect(delReserve).toHaveBeenCalledTimes(2);
  });

  it("scope='single'이면 요청한 세그먼트 하나만 취소한다", async () => {
    (findReservationById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeReservation({ id: "res-1", reservationRequestId: "req-1" })
    );
    (findReservationsByRequestId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1", reservationRequestId: "req-1", cjSeq: "1001" }),
      makeReservation({ id: "res-2", reservationRequestId: "req-1", cjSeq: "1002" }),
    ]);

    const result = await cancelReservation("user-1", { reservationId: "res-1", scope: "single" });
    expect(result).toHaveLength(1);
    expect(result[0].reservationId).toBe("res-1");
    expect(delReserve).toHaveBeenCalledTimes(1);
    expect(delReserve).toHaveBeenCalledWith(expect.anything(), "1001");
  });
});
