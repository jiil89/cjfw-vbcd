// kst.ts 유닛 테스트 — [2026-08-14] 예약 변경/취소가 항상 "시스템 오류"로 실패하던 버그
// (reservationTargeting.hintMatches가 UTC로 저장된 시각을 KST로 변환하지 않고 그냥
// 잘라내서 사용자가 말한 "09:00"과 절대 일치하지 않았음)의 재발을 막는다.

import { describe, expect, it } from "vitest";
import { kstDayRange, toKstDate, toKstHHmm, toKstTimestamp } from "../kst";

describe("toKstTimestamp -- 저장할 때 KST 오프셋을 항상 명시한다", () => {
  it("Postgres 세션 타임존 설정에 의존하지 않도록 +09:00을 직접 붙인다", () => {
    expect(toKstTimestamp("2026-08-17", "09:00")).toBe("2026-08-17T09:00:00+09:00");
  });
});

describe("kstDayRange -- 하루 전체 범위도 오프셋을 명시한다", () => {
  it("00:00부터 23:59:59까지 +09:00로 감싼다", () => {
    expect(kstDayRange("2026-08-17")).toEqual({
      rangeStartAt: "2026-08-17T00:00:00+09:00",
      rangeEndAt: "2026-08-17T23:59:59+09:00",
    });
  });
});

describe("toKstHHmm / toKstDate -- DB에서 읽은 UTC 인스턴트를 한국 시각으로 되돌린다", () => {
  it("09:00 KST로 저장된 값(UTC로는 00:00)을 다시 09:00으로 읽는다", () => {
    // toKstTimestamp("2026-08-17", "09:00")이 실제로 Postgres에 저장되면 UTC 인스턴트
    // 2026-08-17T00:00:00.000Z가 된다 — 실사용 검증에서 확인한 값 그대로 재현.
    expect(toKstHHmm("2026-08-17T00:00:00.000Z")).toBe("09:00");
    expect(toKstDate("2026-08-17T00:00:00.000Z")).toBe("2026-08-17");
  });

  it("자정 근처(한국 07:00 이전)에는 UTC 날짜가 KST와 하루 어긋나므로 날짜도 반드시 KST 기준으로 다시 계산해야 한다", () => {
    // 2026-08-17 06:30 KST == 2026-08-16 21:30 UTC (전날) -- 날짜를 UTC로 그냥 읽으면
    // "2026-08-16"으로 하루 잘못 나온다.
    expect(toKstHHmm("2026-08-16T21:30:00.000Z")).toBe("06:30");
    expect(toKstDate("2026-08-16T21:30:00.000Z")).toBe("2026-08-17");
  });

  it("Date 객체를 그대로 넘겨도 동일하게 동작한다(pg가 실제로 반환하는 타입)", () => {
    expect(toKstHHmm(new Date("2026-08-17T00:00:00.000Z"))).toBe("09:00");
  });
});
