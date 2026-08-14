// reservationRepository.ts 유닛 테스트.
// BE-6 완료조건: `reservations_no_overlap` EXCLUDE 제약(SQLSTATE 23P01) 위반이
// "이미 예약됨" 사용자 메시지로 정상 변환되는지 실제 pg Pool 없이 검증한다.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../pool", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../pool";
import { createReservation, findReservationById, markReservationModified, RoomAlreadyBookedError } from "../reservationRepository";

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

// [2026-08-14 실사용 검증에서 발견] start_at/end_at은 timestamptz라 node-postgres가
// 실제로는 JS Date 객체를 돌려주는데, 이 리포지토리의 Reservation 타입은 string으로
// 선언되어 있었다. reservationTargeting.ts의 hintMatches()가 이 값에 `.slice(11, 16)`을
// 호출하다가 TypeError로 죽어서 예약 변경/취소가 항상 "시스템 오류가 발생했어요"로만
// 실패하는 버그가 있었다 — Date 객체를 그대로 흘려보내면 이 회귀가 재현되지 않으므로,
// pg가 실제로 반환하는 형태(Date 인스턴스)를 그대로 mock해서 문자열로 정규화되는지 검증한다.
describe("findReservationById -- timestamptz 컬럼을 항상 ISO 문자열로 정규화한다", () => {
  it("pg가 Date 객체로 반환해도 startAt/endAt/createdAt/updatedAt이 문자열로 나온다", async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          id: "res-1",
          reservation_request_id: null,
          user_id: "user-1",
          room_id: "room-1",
          cj_seq: "1001",
          title: "회의",
          contents: null,
          start_at: new Date("2026-08-17T09:00:00.000Z"),
          end_at: new Date("2026-08-17T10:00:00.000Z"),
          status: "confirmed",
          created_at: new Date("2026-08-14T00:00:00.000Z"),
          updated_at: new Date("2026-08-14T00:00:00.000Z"),
        },
      ],
    });

    const reservation = await findReservationById("res-1");

    expect(reservation).not.toBeNull();
    expect(typeof reservation!.startAt).toBe("string");
    expect(typeof reservation!.endAt).toBe("string");
    expect(reservation!.startAt).toBe("2026-08-17T09:00:00.000Z");
    // 실제 크래시를 유발했던 사용 패턴(.slice(11,16))이 정상 동작하는지도 함께 확인한다.
    expect(reservation!.startAt.slice(11, 16)).toBe("09:00");
  });
});
