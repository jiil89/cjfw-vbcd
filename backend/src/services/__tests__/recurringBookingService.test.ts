// recurringBookingService.ts 유닛 테스트.
// 5-project-principle.md §4: createReservation과 리포지토리는 전부 목(mock)으로 대체하고,
// 실제 CJ/DB를 호출하는 테스트는 절대 만들지 않는다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories/recurringRuleRepository", () => ({
  findActiveRulesForWeekday: vi.fn(),
  findRunByRuleAndDate: vi.fn(),
  recordRun: vi.fn(),
}));

vi.mock("../../db/repositories/userRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/repositories/userRepository")>();
  return {
    ...actual,
    // hasValidUnattendedBookingConsent는 실제 구현(순수 함수) 그대로 쓰고, findUserById만 목으로 대체한다.
    findUserById: vi.fn(),
  };
});

vi.mock("../../tools/reservation.tool", () => ({
  createReservation: vi.fn(),
  ReservationConflictError: class ReservationConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ReservationConflictError";
    }
  },
}));

import {
  findActiveRulesForWeekday,
  findRunByRuleAndDate,
  recordRun,
  type RecurringRuleWithRooms,
  type RecurringRun,
} from "../../db/repositories/recurringRuleRepository";
import { findUserById } from "../../db/repositories/userRepository";
import type { User } from "../../db/repositories/userRepository";
import { CjLoginError } from "../../cj-automation/session";
import { createReservation, ReservationConflictError } from "../../tools/reservation.tool";
import type { Room } from "../../db/repositories/roomRepository";
import { runRecurringBookingsForTargetDate } from "../recurringBookingService";

function makeRoom(id: string, roomName: string): Room {
  return {
    id,
    site: "상암S시티",
    areaCode: "804",
    subAreaCode: "1128",
    roomCode: id,
    roomName,
    floorLabel: "3F",
    capacity: 8,
    isBookable: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeRule(overrides: Partial<RecurringRuleWithRooms> = {}): RecurringRuleWithRooms {
  return {
    id: "rule-1",
    userId: "user-1",
    weekday: 1,
    startTime: "10:00",
    endTime: "11:00",
    title: "정기 회의",
    contents: null,
    isActive: true,
    rooms: [
      { priority: 1, room: makeRoom("room-1", "3F-1") },
      { priority: 2, room: makeRoom("room-2", "3F-2") },
      { priority: 3, room: makeRoom("room-3", "3F-3") },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    emailAlias: "tester",
    encryptedPassword: "enc",
    appPasswordHash: "hash",
    isAdmin: false,
    status: "active",
    approvedAt: "2026-01-01T00:00:00Z",
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    unattendedBookingConsentAt: "2026-01-01T00:00:00Z",
    unattendedBookingConsentRevokedAt: null,
    ...overrides,
  };
}

// INTER_RULE_DELAY_MS(2초) 지연을 실제로 기다리지 않기 위해 타이머를 페이크로 대체한다.
async function runWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("runRecurringBookingsForTargetDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (findRunByRuleAndDate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (findUserById as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1·2순위가 ReservationConflictError로 실패하고 3순위가 성공하면 succeeded, attempted_priority=3으로 기록한다", async () => {
    const rule = makeRule();
    (findActiveRulesForWeekday as ReturnType<typeof vi.fn>).mockResolvedValue([rule]);
    (createReservation as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new ReservationConflictError("3F-1 이미 예약됨"))
      .mockRejectedValueOnce(new ReservationConflictError("3F-2 이미 예약됨"))
      .mockResolvedValueOnce({
        reservationId: "res-1",
        roomName: "3F-3",
        date: "2026-08-24",
        startTime: "10:00",
        endTime: "11:00",
        cjSeq: "9001",
      });

    const summary = await runWithFakeTimers(runRecurringBookingsForTargetDate("2026-08-24"));

    expect(summary.succeeded).toBe(1);
    expect(createReservation).toHaveBeenCalledTimes(3);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "rule-1",
        targetDate: "2026-08-24",
        status: "succeeded",
        reservationId: "res-1",
        bookedRoomId: "room-3",
        attemptedPriority: 3,
      })
    );
  });

  it("1~3순위 회의실이 모두 실패하면 failed로 기록한다", async () => {
    const rule = makeRule();
    (findActiveRulesForWeekday as ReturnType<typeof vi.fn>).mockResolvedValue([rule]);
    (createReservation as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new ReservationConflictError("3F-1 이미 예약됨"))
      .mockRejectedValueOnce(new ReservationConflictError("3F-2 이미 예약됨"))
      .mockRejectedValueOnce(new ReservationConflictError("3F-3 이미 예약됨"));

    const summary = await runWithFakeTimers(runRecurringBookingsForTargetDate("2026-08-24"));

    expect(summary.failed).toBe(1);
    expect(createReservation).toHaveBeenCalledTimes(3);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "rule-1",
        targetDate: "2026-08-24",
        status: "failed",
        attemptedPriority: 3,
      })
    );
  });

  it("같은 (rule, target_date)가 이미 실행된 기록이 있으면 다시 시도하지 않고 건너뛴다", async () => {
    const rule = makeRule();
    (findActiveRulesForWeekday as ReturnType<typeof vi.fn>).mockResolvedValue([rule]);
    const existingRun: RecurringRun = {
      id: "run-1",
      ruleId: "rule-1",
      targetDate: "2026-08-24",
      status: "succeeded",
      reservationId: "res-old",
      bookedRoomId: "room-1",
      attemptedPriority: 1,
      failureReason: null,
      executedAt: "2026-08-17T00:01:00.000Z",
    };
    (findRunByRuleAndDate as ReturnType<typeof vi.fn>).mockResolvedValue(existingRun);

    const summary = await runWithFakeTimers(runRecurringBookingsForTargetDate("2026-08-24"));

    expect(createReservation).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
    expect(summary.succeeded).toBe(1);
    expect(summary.details[0]).toMatchObject({ ruleId: "rule-1", status: "succeeded" });
  });

  it("CJ 로그인에 실패하면 나머지 순위를 시도하지 않고 즉시 중단한다", async () => {
    // 로그인 실패는 회의실 문제가 아니라서 다음 순위를 시도해도 똑같이 실패한다. 그런데
    // createReservation은 매번 새로 로그인하므로, 그냥 넘어가면 한 규칙에서 실패 로그인이
    // 3회 쌓여 CJ 계정 잠금 정책을 자극한다 — 그래서 1회로 끊는지 확인한다.
    const rule = makeRule();
    (findActiveRulesForWeekday as ReturnType<typeof vi.fn>).mockResolvedValue([rule]);
    (createReservation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CjLoginError("CJ WORLD 계정 로그인에 실패했습니다.")
    );

    const summary = await runWithFakeTimers(runRecurringBookingsForTargetDate("2026-08-24"));

    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(summary.failed).toBe(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "rule-1", status: "failed", attemptedPriority: 1 })
    );
  });

  it("무인 예약 동의가 철회된 사용자는 skipped로 기록하고 CJ를 호출하지 않는다", async () => {
    const rule = makeRule();
    (findActiveRulesForWeekday as ReturnType<typeof vi.fn>).mockResolvedValue([rule]);
    (findUserById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeUser({
        unattendedBookingConsentAt: "2026-01-01T00:00:00Z",
        unattendedBookingConsentRevokedAt: "2026-08-10T00:00:00Z",
      })
    );

    const summary = await runWithFakeTimers(runRecurringBookingsForTargetDate("2026-08-24"));

    expect(createReservation).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "rule-1", targetDate: "2026-08-24", status: "skipped" })
    );
  });
});
