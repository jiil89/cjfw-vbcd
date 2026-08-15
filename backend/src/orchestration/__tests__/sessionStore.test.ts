// sessionStore.ts 유닛 테스트.
// BE-7 완료조건: "세션 상태(진행 중인 예약 등)가 대화록 텍스트가 아니라 서버 상태로
// 관리됨" + "SaveReserve 직전 명시적 확인 없이는 실행되지 않음"의 핵심 가드
// (validatePendingConfirmation의 "같은 턴 confirm 거부" 로직)를 검증한다.
//
// [2026-08-16] sessionStore.ts가 DB(chatSessionRepository)에 로드/저장하도록 바뀌면서
// 이 파일도 실제 DB 대신 메모리 기반 페이크 저장소로 대체해 테스트한다(기존 다른
// 리포지토리 테스트가 pool.query를 vi.mock하는 것과 같은 패턴 — reservationRepository
// 테스트 참고). 판정 로직(validatePendingConfirmation 등)은 여전히 순수 함수라 세션
// 객체를 직접 조작해서 테스트하고, 로드/저장이 실제로 왕복되는지는 별도로 검증한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDb = new Map<string, unknown>();

vi.mock("../../db/repositories/chatSessionRepository", () => ({
  loadChatSessionState: vi.fn(async (userId: string) => fakeDb.get(userId) ?? null),
  saveChatSessionState: vi.fn(async (userId: string, state: unknown) => {
    // 실제 Postgres jsonb 왕복과 같은 방식으로 직렬화/역직렬화해 참조 공유 버그를 잡는다.
    fakeDb.set(userId, JSON.parse(JSON.stringify(state)));
  }),
}));

import {
  appendMessage,
  getOrCreateSession,
  isResolvedTarget,
  resetSession,
  saveSession,
  setOfferedSlots,
  setPendingConfirmation,
  setResolvedTarget,
  validatePendingConfirmation,
  wasSlotOfferedBefore,
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
    fakeDb.clear();
  });

  it("getOrCreateSession은 저장한 내용을 다음 호출에서 그대로 불러온다", async () => {
    const session = await getOrCreateSession("user-1");
    appendMessage(session, { role: "user", content: "안녕" });
    await saveSession(session);

    const reloaded = await getOrCreateSession("user-1");
    expect(reloaded.messages).toHaveLength(1);
    expect(reloaded.messages[0].content).toBe("안녕");
  });

  it("저장한 적 없는 사용자는 빈 세션을 받는다", async () => {
    const session = await getOrCreateSession("user-never-saved");
    expect(session.messages).toHaveLength(0);
    expect(session.pendingConfirmation).toBeNull();
    expect(session.turnIndex).toBe(0);
  });

  it("resetSession 이후에는 messages/pendingConfirmation이 모두 비워지고 그 상태로 저장된다", async () => {
    const session = await getOrCreateSession("user-1");
    appendMessage(session, { role: "user", content: "안녕" });
    setPendingConfirmation(session, makePending());
    session.turnIndex = 5;
    await saveSession(session);

    const fresh = await resetSession("user-1");
    expect(fresh.messages).toHaveLength(0);
    expect(fresh.pendingConfirmation).toBeNull();
    expect(fresh.turnIndex).toBe(0);

    const reloaded = await getOrCreateSession("user-1");
    expect(reloaded.messages).toHaveLength(0);
  });

  it("appendMessage는 히스토리 상한을 넘으면 오래된 메시지부터 잘라낸다 (비용 절감)", async () => {
    const session = await getOrCreateSession("user-1");
    for (let i = 0; i < 30; i += 1) {
      appendMessage(session, { role: "user", content: `메시지-${i}` });
    }
    expect(session.messages.length).toBeLessThanOrEqual(20);
    // 가장 최근 메시지는 반드시 남아있어야 한다.
    expect(session.messages[session.messages.length - 1].content).toBe("메시지-29");
  });

  it("히스토리를 자를 때 tool 메시지를 배열 맨 앞에 고아로 남기지 않는다 (실사용 버그 회귀 방지)", async () => {
    // [2026-08-14 실사용 검증에서 발견] 자름 지점이 tool 메시지 한가운데 걸리면 그
    // assistant(tool_calls)는 잘려나가고 tool 응답만 맨 앞에 남아, OpenAI가
    // "messages with role 'tool' must be a response to a preceeding message with
    // 'tool_calls'"로 이후 모든 턴을 거부하는 버그가 실제로 재현됐었다.
    const session = await getOrCreateSession("user-1");
    // 20개를 넘기되, 자름 지점(딱 상한을 넘기는 지점)이 tool 메시지에 걸리도록
    // "assistant(tool_calls) + tool 2개"로 이루어진 3개짜리 묶음을 반복 추가한다.
    for (let i = 0; i < 8; i += 1) {
      appendMessage(session, {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: `call-${i}-a`, type: "function", function: { name: "check_availability", arguments: "{}" } },
          { id: `call-${i}-b`, type: "function", function: { name: "check_availability", arguments: "{}" } },
        ],
      });
      appendMessage(session, { role: "tool", tool_call_id: `call-${i}-a`, name: "check_availability", content: "{}" });
      appendMessage(session, { role: "tool", tool_call_id: `call-${i}-b`, name: "check_availability", content: "{}" });
    }

    expect(session.messages.length).toBeLessThanOrEqual(20);
    expect(session.messages[0].role).not.toBe("tool");
  });

  it("pendingConfirmation이 없으면 confirm을 거부한다", async () => {
    const session = await getOrCreateSession("user-1");
    const result = validatePendingConfirmation(session, "token-1", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("토큰이 일치하지 않으면 confirm을 거부한다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 2;
    setPendingConfirmation(session, makePending({ token: "real-token", createdAtTurn: 1 }));

    const result = validatePendingConfirmation(session, "wrong-token", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("kind가 다르면 confirm을 거부한다 (엉뚱한 확정 도구 호출 방지)", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 2;
    setPendingConfirmation(session, makePending({ token: "real-token", kind: "create_reservation", createdAtTurn: 1 }));

    const result = validatePendingConfirmation(session, "real-token", "cancel_reservation");
    expect(result.ok).toBe(false);
  });

  it("같은 턴(createdAtTurn === turnIndex)에서 곧바로 confirm하면 거부한다 -- 반드시 다음 턴이어야 한다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 3;
    setPendingConfirmation(session, makePending({ token: "real-token", createdAtTurn: 3 }));

    const result = validatePendingConfirmation(session, "real-token", "create_reservation");
    expect(result.ok).toBe(false);
  });

  it("이전 턴에 등록된 토큰이 이번 턴에 정확히 일치하면 confirm을 허용한다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 4;
    const pending = makePending({ token: "real-token", createdAtTurn: 3 });
    setPendingConfirmation(session, pending);

    const result = validatePendingConfirmation(session, "real-token", "create_reservation");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pending).toEqual(pending);
    }
  });

  // 확인 클릭 생략(3-5b) 판정 -- LLM의 주장이 아니라 서버 기록으로만 판정해야 한다.
  const slot = { roomId: "room-1", date: "2026-08-17", startTime: "10:00", endTime: "11:00" };

  it("이전 턴에 보여준 슬롯을 사용자가 고르면 확인 생략 대상으로 판정한다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 1;
    setOfferedSlots(session, [slot]);

    session.turnIndex = 2; // 사용자가 목록을 보고 다음 메시지를 보낸 상황
    expect(wasSlotOfferedBefore(session, slot)).toBe(true);
  });

  it("같은 턴에 조회하고 곧바로 예약하는 건 확인 생략 대상이 아니다 -- 사용자가 목록을 본 적이 없다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 1;
    setOfferedSlots(session, [slot]);

    expect(wasSlotOfferedBefore(session, slot)).toBe(false);
  });

  it("보여준 적 없는 슬롯(시간/회의실이 다름)은 확인 생략 대상이 아니다", async () => {
    const session = await getOrCreateSession("user-1");
    session.turnIndex = 1;
    setOfferedSlots(session, [slot]);
    session.turnIndex = 2;

    expect(wasSlotOfferedBefore(session, { ...slot, roomId: "room-2" })).toBe(false);
    expect(wasSlotOfferedBefore(session, { ...slot, startTime: "14:00" })).toBe(false);
    expect(wasSlotOfferedBefore(session, { ...slot, date: "2026-08-18" })).toBe(false);
  });

  it("서버가 1건으로 좁힌 예약만 변경/취소 확인 생략 대상이 된다", async () => {
    const session = await getOrCreateSession("user-1");
    setResolvedTarget(session, "res-1");

    expect(isResolvedTarget(session, "res-1")).toBe(true);
    expect(isResolvedTarget(session, "res-2")).toBe(false);

    setResolvedTarget(session, null);
    expect(isResolvedTarget(session, "res-1")).toBe(false);
  });

  it("타임아웃(30분 초과) 후 getOrCreateSession을 호출하면 세션이 리셋된다", async () => {
    const session = await getOrCreateSession("user-1");
    appendMessage(session, { role: "user", content: "안녕" });
    session.lastActivityAt = Date.now() - 31 * 60 * 1000;
    await saveSession(session);

    const fresh = await getOrCreateSession("user-1");
    expect(fresh.messages).toHaveLength(0);
  });

  it("DB에 저장된 값이 손상돼 있으면(필드 누락 등) 빈 세션으로 안전하게 대체한다", async () => {
    fakeDb.set("user-corrupt", { garbage: true });

    const session = await getOrCreateSession("user-corrupt");
    expect(session.messages).toHaveLength(0);
    expect(session.turnIndex).toBe(0);
  });
});
