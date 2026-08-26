// systemPrompt.ts 유닛 테스트.
// BE-7 완료조건: 운영시간/2시간 제한/7일 범위/지원 사업장(상암S시티, YTN 본사)/반복예약은
// 사이드바에서 등록(채팅 미지원) 등이 시스템 프롬프트에 명시되고, "요청 처리 가능 여부
// 판단" 원칙이 프롬프트 최상위에 반영되는지 확인한다.

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../systemPrompt";

const SAMPLE_ROOMS = [
  { roomName: "3F-1", floorLabel: "3F", capacity: 8 },
  { roomName: "14F-2", floorLabel: "14F", capacity: 12 },
];

describe("buildSystemPrompt", () => {
  it("요청 처리 가능 여부 판단 원칙이 프롬프트의 가장 앞부분(0번 섹션)에 나온다", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    const principleIndex = prompt.indexOf("요청 처리 가능 여부 먼저 판단");
    const businessRulesIndex = prompt.indexOf("비즈니스 규칙 (도메인 정의서 6번");
    expect(principleIndex).toBeGreaterThan(-1);
    expect(businessRulesIndex).toBeGreaterThan(-1);
    expect(principleIndex).toBeLessThan(businessRulesIndex);
  });

  it("핵심 비즈니스 규칙이 모두 텍스트로 포함된다", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("상암S시티");
    expect(prompt).toContain("07:00");
    expect(prompt).toContain("19:00");
    expect(prompt).toContain("2시간(120분)");
    expect(prompt).toContain("오늘부터 7일 뒤까지");
    expect(prompt).toContain("반복 예약(매주/매일 등)은 채팅으로 등록할 수 없습니다");
    expect(prompt).toContain("장비 조건");
    expect(prompt).toContain("3F, 12F~16F");
  });

  // [20260826 추가] YTN 본사(2번째 사업장) 지원 — systemPrompt가 두 사업장 모두를
  // 지원 범위로 명시하는지 확인한다(사업장 하드코딩 회귀 방지).
  it("두 번째 사업장(YTN 본사)과 그 층(17F)도 지원 범위로 명시된다", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("YTN 본사");
    expect(prompt).toContain("17F");
  });

  it("오늘 날짜가 그대로 주입된다 (LLM의 날짜 계산을 신뢰하지 않음)", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("2026-08-13");
  });

  it("친절한 말투 규칙과 짧게 답하라는 규칙이 함께 들어간다 (짧다고 무뚝뚝해지면 안 됨)", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("짧게, 그리고 친절하게");
    expect(prompt).toContain("정중한 존댓말");
    expect(prompt).toContain("대안을 함께 제시");
    // 친절함을 이유로 답변이 길어지면 카드와 내용이 중복되므로 분량 제한은 그대로 유지돼야 한다.
    expect(prompt).toContain("전체 답변은 1~3문장으로 끝냅니다");
  });

  it("상대 날짜 표를 서버가 미리 계산해서 넣어준다 -- 모델이 '차주 월요일'을 암산하다 틀린 회귀 방지", () => {
    // 2026-08-13은 목요일. 이번주 월요일은 8/10이므로 "다음주 월요일"은 8/17이다.
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("2026-08-13(목요일) = 오늘, 이번주 목요일");
    expect(prompt).toContain("2026-08-14(금요일) = 내일, 이번주 금요일");
    expect(prompt).toContain("2026-08-17(월요일) = 4일 후, 다음주 월요일");
    expect(prompt).toContain("2026-08-21(금요일) = 8일 후, 다음주 금요일");
  });

  it("회의실 목록이 층별로 정리되어 포함된다", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("3F-1(정원 8인)");
    expect(prompt).toContain("14F-2(정원 12인)");
  });

  it("pendingConfirmation이 있으면 confirmationToken과 함께 프롬프트에 주입된다 (대화록 텍스트가 아니라 서버 상태 기반)", () => {
    const prompt = buildSystemPrompt({
      today: "2026-08-13",
      rooms: SAMPLE_ROOMS,
      pendingConfirmation: { kind: "create_reservation", token: "abc-123", summary: "3F-1 15:00~16:00" },
    });
    expect(prompt).toContain("abc-123");
    expect(prompt).toContain("3F-1 15:00~16:00");
  });

  it("pendingConfirmation이 없으면 대기 중 제안 섹션이 없다", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).not.toContain("지금 사용자의 확인을 기다리고 있는 제안이 있습니다");
  });

  // [2026-08-16 추가] OpenAI 프롬프트 캐싱은 "앞부분이 정확히 일치하는 구간까지만" 캐시를
  // 재사용한다 — 한 글자라도 다르면 그 뒤 전체가 통째로 캐시 미스가 된다. pendingConfirmation은
  // propose 직후/confirm 이후로 매 턴 바뀌는 값이라, 예전에는 이걸 프롬프트 중간(§3-5b
  // 다음)에 끼워 넣어서 회의실 목록·응답 스타일 규칙을 포함한 뒷부분 전체가 매번 다시
  // 계산됐다. pendingConfirmation을 프롬프트 맨 끝에만 붙이도록 옮겨서, 그 앞부분(회의실
  // 목록 포함)은 확인 대기 상태와 무관하게 항상 동일한 문자열이 되게 했다 — 이게 깨지면
  // 캐시 적중률이 실사용 트래픽에서 조용히 나빠지므로 회귀 테스트로 고정한다.
  it("pendingConfirmation 유무와 무관하게 프롬프트 앞부분(회의실 목록 포함)이 완전히 동일하다 (프롬프트 캐싱 적중률 보존)", () => {
    const base = { today: "2026-08-13", rooms: SAMPLE_ROOMS };
    const withoutPending = buildSystemPrompt(base);
    const withPending = buildSystemPrompt({
      ...base,
      pendingConfirmation: { kind: "create_reservation", token: "abc-123", summary: "3F-1 15:00~16:00" },
    });

    // withPending은 withoutPending 뒤에 내용을 "추가"한 것이어야 한다 — 중간에 끼워넣으면
    // 이 접두사 검사가 실패한다.
    expect(withPending.startsWith(withoutPending)).toBe(true);
    // 회의실 목록처럼 상대적으로 큰 정적 블록이 여전히 공통 접두사 안에 있는지도 확인한다.
    expect(withoutPending).toContain("3F-1(정원 8인)");
    const roomListIndex = withoutPending.indexOf("3F-1(정원 8인)");
    expect(withPending.slice(0, roomListIndex + 20)).toBe(withoutPending.slice(0, roomListIndex + 20));
  });
});
