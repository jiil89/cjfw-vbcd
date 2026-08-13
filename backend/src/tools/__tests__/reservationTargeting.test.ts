// reservationTargeting.ts 유닛 테스트.
// BE-6 완료조건: "예약 변경/취소는 대상이 모호할 때(여러 건) 바로 진행하지 않고 명확한
// 오류/안내를 반환함" 을 여기서 증명한다.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories/reservationRepository", async () => {
  const actual = await vi.importActual<typeof import("../../db/repositories/reservationRepository")>(
    "../../db/repositories/reservationRepository"
  );
  return { ...actual, findActiveReservationsWithRoomByUserAndRange: vi.fn() };
});

import { findActiveReservationsWithRoomByUserAndRange } from "../../db/repositories/reservationRepository";
import {
  AmbiguousReservationTargetError,
  ReservationNotFoundError,
  resolveSingleReservationTarget,
} from "../reservationTargeting";

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
    roomName: "3F-1",
    roomCode: "3F-1",
    floorLabel: "3F",
    ...overrides,
  };
}

describe("resolveSingleReservationTarget", () => {
  it("후보가 정확히 1건이면 그대로 반환한다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1" }),
    ]);

    const result = await resolveSingleReservationTarget("user-1", { date: "2026-08-14" });
    expect(result.id).toBe("res-1");
  });

  it("후보가 0건이면 ReservationNotFoundError를 던진다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await expect(resolveSingleReservationTarget("user-1", { date: "2026-08-14" })).rejects.toBeInstanceOf(
      ReservationNotFoundError
    );
  });

  it("후보가 2건 이상이면 AmbiguousReservationTargetError로 후보 목록과 함께 되묻는다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1", startAt: "2026-08-14T15:00:00", endAt: "2026-08-14T16:00:00" }),
      makeReservation({ id: "res-2", startAt: "2026-08-14T17:00:00", endAt: "2026-08-14T18:00:00" }),
    ]);

    try {
      await resolveSingleReservationTarget("user-1", { date: "2026-08-14" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousReservationTargetError);
      expect((err as AmbiguousReservationTargetError).candidates).toHaveLength(2);
    }
  });

  it("startTime/roomName 힌트로 후보를 좁혀 1건으로 특정할 수 있으면 되묻지 않는다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeReservation({ id: "res-1", roomName: "3F-1", startAt: "2026-08-14T15:00:00" }),
      makeReservation({ id: "res-2", roomName: "12F-2", startAt: "2026-08-14T17:00:00" }),
    ]);

    const result = await resolveSingleReservationTarget("user-1", {
      date: "2026-08-14",
      startTime: "15:00",
    });
    expect(result.id).toBe("res-1");
  });
});
