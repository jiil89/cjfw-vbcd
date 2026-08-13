// businessRules.ts 유닛 테스트 (5-project-principle.md 4번: 비즈니스 규칙은 유닛 테스트 대상).

import { describe, expect, it } from "vitest";
import {
  assertValidReservationWindow,
  isWithinBookableDateRange,
  isWithinOperatingHours,
} from "../businessRules";

describe("isWithinBookableDateRange -- 오늘부터 7일 뒤까지 (도메인 정의서 6번)", () => {
  it("오늘은 예약 가능하다", () => {
    expect(isWithinBookableDateRange("2026-08-13", "2026-08-13")).toBe(true);
  });
  it("7일 뒤까지는 예약 가능하다", () => {
    expect(isWithinBookableDateRange("2026-08-20", "2026-08-13")).toBe(true);
  });
  it("8일 뒤는 예약 불가능하다", () => {
    expect(isWithinBookableDateRange("2026-08-21", "2026-08-13")).toBe(false);
  });
  it("과거 날짜는 예약 불가능하다", () => {
    expect(isWithinBookableDateRange("2026-08-12", "2026-08-13")).toBe(false);
  });
});

describe("isWithinOperatingHours -- 07:00~19:00 (도메인 정의서 6번)", () => {
  it("운영시간 안이면 true", () => {
    expect(isWithinOperatingHours("09:00", "10:00")).toBe(true);
  });
  it("07:00 정각 시작은 가능하다", () => {
    expect(isWithinOperatingHours("07:00", "08:00")).toBe(true);
  });
  it("19:00을 넘어가면 false", () => {
    expect(isWithinOperatingHours("18:30", "19:30")).toBe(false);
  });
  it("06:30처럼 07:00 이전 시작은 false", () => {
    expect(isWithinOperatingHours("06:30", "07:30")).toBe(false);
  });
});

describe("assertValidReservationWindow", () => {
  it("정상 범위는 예외를 던지지 않는다", () => {
    expect(() =>
      assertValidReservationWindow({
        date: "2026-08-14",
        today: "2026-08-13",
        startTime: "14:00",
        endTime: "15:00",
      })
    ).not.toThrow();
  });

  it("30분 단위가 아니면 예외를 던진다", () => {
    expect(() =>
      assertValidReservationWindow({
        date: "2026-08-14",
        today: "2026-08-13",
        startTime: "14:10",
        endTime: "15:00",
      })
    ).toThrow();
  });

  it("7일 범위를 벗어나면 예외를 던진다", () => {
    expect(() =>
      assertValidReservationWindow({
        date: "2026-08-25",
        today: "2026-08-13",
        startTime: "14:00",
        endTime: "15:00",
      })
    ).toThrow();
  });
});
