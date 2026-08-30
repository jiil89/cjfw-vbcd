// myReservations.tool.ts 유닛 테스트.
// [2026-08-31 수정 검증] 이 챗봇 밖(CJ WORLD 웹사이트 등)에서 잡힌 예약도 bindMyReservation
// 실제 응답을 통해 함께 보여주되, 우리 DB에 이미 있는 예약(cj_seq로 매칭)은 중복으로
// 보여주지 않는지 확인한다(실사용에서 "오늘 예약된 회의실을 에이전트가 인식 못한다"는
// 문제로 발견됨).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cj-automation/client", () => ({ bindMyReservation: vi.fn() }));
vi.mock("../../cj-automation/session", () => ({
  getValidSession: vi.fn(async () => ({ cookieHeader: "fake", baseUrl: "https://example.test" })),
}));
vi.mock("../../db/repositories/reservationRepository", () => ({
  findActiveReservationsWithRoomByUserAndRange: vi.fn(),
}));
vi.mock("../availability.tool", () => ({
  resolveEmailAlias: vi.fn(async () => "jiil"),
}));

import { bindMyReservation } from "../../cj-automation/client";
import { findActiveReservationsWithRoomByUserAndRange } from "../../db/repositories/reservationRepository";
import { getMyReservations } from "../myReservations.tool";

function dbReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-res-1",
    reservationRequestId: null,
    title: "주간 정기회의",
    roomName: "3F-10",
    startAt: "2026-08-31T06:00:00.000Z",
    endAt: "2026-08-31T07:00:00.000Z",
    cjSeq: "6652690",
    ...overrides,
  };
}

function cjRow(overrides: Record<string, unknown> = {}) {
  return {
    SEQ: "6652690",
    ROOM_NAME: "3F-10",
    CONF_TITE: "주간 정기회의",
    CONTENTS: "주간 정기회의",
    START_DATE: "2026-08-31",
    START_TIME: "15:00",
    END_TIME: "16:00",
    DEL_YN: "0",
    ...overrides,
  };
}

describe("getMyReservations -- DB 기록 + CJ 실제 응답 병합", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DB에 있는 예약과 CJ 응답의 같은 예약(cj_seq 일치)은 중복으로 보여주지 않는다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      dbReservation(),
    ]);
    (bindMyReservation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Table: [cjRow({ SEQ: "6652690" })],
    });

    const groups = await getMyReservations("user-1", { fromDate: "2026-08-31", toDate: "2026-08-31" });

    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe("app");
    expect(groups[0].segments[0].reservationId).toBe("db-res-1");
  });

  it("우리 DB에 없는 CJ 예약(챗봇 밖에서 잡힘)도 source='cj'로 함께 보여준다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      dbReservation(),
    ]);
    (bindMyReservation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Table: [
        cjRow({ SEQ: "6652690" }),
        cjRow({
          SEQ: "6652522",
          ROOM_NAME: "3F-12",
          CONF_TITE: "메뉴디자이너",
          START_TIME: "10:30",
          END_TIME: "12:00",
        }),
      ],
    });

    const groups = await getMyReservations("user-1", { fromDate: "2026-08-31", toDate: "2026-08-31" });

    expect(groups).toHaveLength(2);
    const cjOnly = groups.find((g) => g.source === "cj");
    expect(cjOnly).toBeDefined();
    expect(cjOnly!.title).toBe("메뉴디자이너");
    expect(cjOnly!.segments[0].reservationId).toBeNull();
    expect(cjOnly!.segments[0].roomName).toBe("3F-12");
    // END_DATETIME이 아니라 END_TIME(12:00)을 써야 한다 — client.ts 주석의 함정 참고.
    expect(cjOnly!.segments[0].startAt).toBe("2026-08-31T10:30:00+09:00");
    expect(cjOnly!.segments[0].endAt).toBe("2026-08-31T12:00:00+09:00");
  });

  it("DEL_YN이 '0'이 아닌 CJ 행은 무시한다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (bindMyReservation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Table: [cjRow({ SEQ: "9999", DEL_YN: "1" })],
    });

    const groups = await getMyReservations("user-1", { fromDate: "2026-08-31", toDate: "2026-08-31" });

    expect(groups).toHaveLength(0);
  });

  it("bindMyReservation이 실패해도 DB 기준 결과는 그대로 반환한다", async () => {
    (findActiveReservationsWithRoomByUserAndRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      dbReservation(),
    ]);
    (bindMyReservation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("CJ 일시 오류"));

    const groups = await getMyReservations("user-1", { fromDate: "2026-08-31", toDate: "2026-08-31" });

    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBe("app");
  });
});
