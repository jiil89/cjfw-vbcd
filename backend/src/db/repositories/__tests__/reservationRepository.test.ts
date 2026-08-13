// reservationRepository.ts 유닛 테스트.
// BE-6 완료조건: `reservations_no_overlap` EXCLUDE 제약(SQLSTATE 23P01) 위반이
// "이미 예약됨" 사용자 메시지로 정상 변환되는지 실제 pg Pool 없이 검증한다.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../pool", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../pool";
import { createReservation, markReservationModified, RoomAlreadyBookedError } from "../reservationRepository";

function exclusionViolationError() {
  const err = new Error("conflicting key value violates exclusion constraint") as Error & { code: string };
  err.code = "23P01";
  return err;
}

describe("createReservation -- reservations_no_overlap 위반 변환", () => {
  it("SQLSTATE 23P01(exclusion_violation)을 RoomAlreadyBookedError로 변환한다", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(exclusionViolationError());

    await expect(
      createReservation({
        reservationRequestId: "req-1",
        userId: "user-1",
        roomId: "room-1",
        cjSeq: "1001",
        title: "회의",
        contents: null,
        startAt: "2026-08-14T14:00:00",
        endAt: "2026-08-14T15:00:00",
      })
    ).rejects.toBeInstanceOf(RoomAlreadyBookedError);
  });

  it("그 외 DB 에러는 그대로 전파한다", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      createReservation({
        reservationRequestId: "req-1",
        userId: "user-1",
        roomId: "room-1",
        cjSeq: "1001",
        title: "회의",
        contents: null,
        startAt: "2026-08-14T14:00:00",
        endAt: "2026-08-14T15:00:00",
      })
    ).rejects.toThrow("connection lost");
  });
});

describe("markReservationModified -- 변경 시에도 동일하게 변환된다", () => {
  it("SQLSTATE 23P01을 RoomAlreadyBookedError로 변환한다", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(exclusionViolationError());

    await expect(markReservationModified("res-1", { startAt: "2026-08-14T16:00:00" })).rejects.toBeInstanceOf(
      RoomAlreadyBookedError
    );
  });
});
