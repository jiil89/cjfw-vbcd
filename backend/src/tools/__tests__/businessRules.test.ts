// businessRules.ts 유닛 테스트 (5-project-principle.md 4번: 비즈니스 규칙은 유닛 테스트 대상).

import { describe, expect, it } from "vitest";
import {
  assertValidReservationWindow,
  DEFAULT_RESERVATION_TITLE,
  isWithinBookableDateRange,
  isWithinOperatingHours,
  normalizeReservationTitle,
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

// [20260816 실사용 버그] 목록에서 회의실을 고르면 서버가 즉시 실행하는 경로(3-5b)에서,
// 모델이 회의명을 사용자에게 묻지 않고 "회의"로 지어내 저장해버린 사례가 나왔다.
// 프롬프트로 금지했는데도 발생했으므로 서버가 결정론적으로 교정한다.
describe("normalizeReservationTitle -- 회의명 placeholder를 기본 제목으로 교정", () => {
  it("사용자가 실제로 준 제목은 그대로 쓴다", () => {
    expect(normalizeReservationTitle("AI 과제리뷰")).toBe("AI 과제리뷰");
  });

  it("비어있거나 공백뿐이면 기본 제목으로 바꾼다", () => {
    expect(normalizeReservationTitle("")).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle("   ")).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle(null)).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle(undefined)).toBe(DEFAULT_RESERVATION_TITLE);
  });

  it("모델이 지어낸 placeholder(\"회의\"/\"미팅\" 등)는 기본 제목으로 바꾼다", () => {
    expect(normalizeReservationTitle("회의")).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle("미팅")).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle("  회의  ")).toBe(DEFAULT_RESERVATION_TITLE);
    expect(normalizeReservationTitle("Meeting")).toBe(DEFAULT_RESERVATION_TITLE);
  });

  it("placeholder를 포함하지만 더 구체적인 제목은 그대로 둔다", () => {
    expect(normalizeReservationTitle("주간 회의")).toBe("주간 회의");
    expect(normalizeReservationTitle("팀 미팅")).toBe("팀 미팅");
  });
});
