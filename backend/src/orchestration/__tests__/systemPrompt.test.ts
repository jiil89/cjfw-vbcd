// systemPrompt.ts 유닛 테스트.
// BE-7 완료조건: 운영시간/2시간 제한/7일 범위/상암S시티 고정/반복예약 미지원 등이
// 시스템 프롬프트에 명시되고, "요청 처리 가능 여부 판단" 원칙이 프롬프트 최상위에
// 반영되는지 확인한다.

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
    expect(prompt).toContain("반복 예약(매주/매일 등)은 지원하지 않습니다");
    expect(prompt).toContain("장비 조건");
    expect(prompt).toContain("3F, 12F~16F");
  });

  it("오늘 날짜가 그대로 주입된다 (LLM의 날짜 계산을 신뢰하지 않음)", () => {
    const prompt = buildSystemPrompt({ today: "2026-08-13", rooms: SAMPLE_ROOMS });
    expect(prompt).toContain("2026-08-13");
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
});
