// sessionStore.ts 유닛 테스트.
// BE-7 완료조건: "세션 상태(진행 중인 예약 등)가 대화록 텍스트가 아니라 서버 상태로
// 관리됨" + "SaveReserve 직전 명시적 확인 없이는 실행되지 않음"의 핵심 가드
// (validatePendingConfirmation의 "같은 턴 confirm 거부" 로직)를 검증한다.

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetAllSessionsForTest,
  appendMessage,
  getOrCreateSession,
  resetSession,
  setPendingConfirmation,
  validatePendingConfirmation,
  type PendingConfirmation,
} from "../sessionStore";

function makePending(overrides: Partial<PendingConfirmation> = {}): PendingConfirmation {
  return {
    token: "token-1",
    kind: "create_reservation",
    summary: "3F-1 2026-08-14 15:00~16:00 \"주간회의\"",
    params: { foo: "bar" },
    createdAtTurn: 1,
    ...overrides,
  };
}

describe("sessionStore", () => {
  beforeEach(() => {
    __resetAllSessionsForTest();
  });

  it("getOrCreateSession은 같은 userId에 대해 항상 같은 세션 객체를 반환한다", () => {
    const a = getOrCreateSession("user-1");
    const b = getOrCreateSession("user-1");
    expect(a).toBe(b);
  });

  it("resetSession 이후에는 messages/pendingConfirmation이 모두 비워진다", () => {
    const session = getOrCreateSession("user-1");
    appendMessage(session, { role: "user", content: "안녕" });
    setPendingConfirmation(session, makePending());
    session.turnIndex = 5;

    const fresh = resetSession("user-1");
    expect(fresh.messages).toHaveLength(0);
    expect(fresh.pendingConfirmation).toBeNull();
    expect(fresh.turnIndex).toBe(0);
    expect(getOrCreateSession("user-1")).toBe(fresh);
  });

  it("appendMessage는 히스토리 상한을 넘으면 오래된 메시지부터 잘라낸다 (비용 절감)", () => {
    const session = getOrCreateSession("user-1");
    for (let i = 0; i < 30; i += 1) {
      appendMessage(session, { role: "user", content: `메시지-${i}` });
    }
    expect(session.messages.length).toBeLessThanOrEqual(20);
    // 가장 최근 메시지는 반드시 남아있어야 한다.
    expect(session.messages[session.messages.length - 1].content).toBe("메시지-29");
  });

  it("pendingConfirmation이 없으면 confirm을 거부한다", () => {
    const session = getOrCreateSession("user-1");
    const result = validatePendingConfirmation(session, "token-1", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("토큰이 일치하지 않으면 confirm을 거부한다", () => {
    const session = getOrCreateSession("user-1");
    session.turnIndex = 2;
    setPendingConfirmation(session, makePending({ token: "real-token", createdAtTurn: 1 }));

    const result = validatePendingConfirmation(session, "wrong-token", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("kind가 다르면 confirm을 거부한다 (엉뚱한 확정 도구 호출 방지)", () => {
    const session = getOrCreateSession("user-1");
    session.turnIndex = 2;
    setPendingConfirmation(session, makePending({ token: "real-token", kind: "create_reservation", createdAtTurn: 1 }));

    const result = validatePendingConfirmation(session, "real-token", "cancel_reservation");
    expect(result.ok).toBe(false);
  });

  it("같은 턴(createdAtTurn === turnIndex)에서 곧바로 confirm하면 거부한다 -- 반드시 다음 턴이어야 한다", () => {
    const session = getOrCreateSession("user-1");
    session.turnIndex = 3;
    setPendingConfirmation(session, makePending({ token: "real-token", createdAtTurn: 3 }));

    const result = validatePendingConfirmation(session, "real-token", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("이전 턴에 등록된 토큰이 이번 턴에 정확히 일치하면 confirm을 허용한다", () => {
    const session = getOrCreateSession("user-1");
    session.turnIndex = 4;
    const pending = makePending({ token: "real-token", createdAtTurn: 3 });
    setPendingConfirmation(session, pending);

    const result = validatePendingConfirmation(session, "real-token", "create_reservation");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pending).toEqual(pending);
    }
  });

  it("타임아웃(30분 초과) 후 getOrCreateSession을 호출하면 세션이 리셋된다", () => {
    const session = getOrCreateSession("user-1");
    appendMessage(session, { role: "user", content: "안녕" });
    session.lastActivityAt = Date.now() - 31 * 60 * 1000;

    const fresh = getOrCreateSession("user-1");
    expect(fresh.messages).toHaveLength(0);
    expect(fresh).not.toBe(session);
  });
});
