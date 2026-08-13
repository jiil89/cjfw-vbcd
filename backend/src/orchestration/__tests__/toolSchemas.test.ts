// toolSchemas.ts 유닛 테스트 -- OpenAI tool-calling 스키마 자체의 파싱/정합성 검증.
// BE-7 완료조건: "실제 CJ 저장(SaveReserve)으로 이어지는 도구는 confirm_*으로 분리되고,
// confirmationToken을 필수로 요구한다"를 스키마 레벨에서도 강제되는지 확인한다.

import { describe, expect, it } from "vitest";
import { TOOL_NAMES, toolSchemas } from "../toolSchemas";

const WRITE_TOOL_NAMES = [
  "confirm_create_reservation",
  "confirm_split_reservation",
  "confirm_modify_reservation",
  "confirm_cancel_reservation",
];

const PROPOSE_TOOL_NAMES = [
  "propose_create_reservation",
  "propose_split_reservation",
  "propose_modify_reservation",
  "propose_cancel_reservation",
];

describe("toolSchemas", () => {
  it("모든 도구 이름이 유일하다", () => {
    const names = toolSchemas.map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("TOOL_NAMES는 toolSchemas의 함수 이름과 정확히 일치한다", () => {
    expect(TOOL_NAMES).toEqual(toolSchemas.map((t) => t.function.name));
  });

  it("모든 도구가 유효한 JSON Schema object 파라미터를 가진다 (parameters.type === 'object')", () => {
    for (const tool of toolSchemas) {
      expect(tool.type).toBe("function");
      expect(tool.function.parameters.type).toBe("object");
      expect(tool.function.parameters.additionalProperties).toBe(false);
    }
  });

  it.each(WRITE_TOOL_NAMES)(
    "%s(실제 CJ 저장을 실행하는 확정 도구)는 confirmationToken만 필수로 받는다",
    (name) => {
      const tool = toolSchemas.find((t) => t.function.name === name);
      expect(tool).toBeDefined();
      const { properties, required } = tool!.function.parameters;
      expect(Object.keys(properties)).toEqual(["confirmationToken"]);
      expect(required).toEqual(["confirmationToken"]);
    }
  );

  it.each(PROPOSE_TOOL_NAMES)(
    "%s(제안 도구)는 confirmationToken 파라미터를 받지 않는다 (아직 실행 전이므로 존재할 수 없음)",
    (name) => {
      const tool = toolSchemas.find((t) => t.function.name === name);
      expect(tool).toBeDefined();
      expect(Object.keys(tool!.function.parameters.properties)).not.toContain("confirmationToken");
    }
  );

  it("propose_create_reservation은 room 파라미터에 CJ 예약 생성에 필요한 필드를 필수로 요구한다", () => {
    const tool = toolSchemas.find((t) => t.function.name === "propose_create_reservation");
    expect(tool).toBeDefined();
    const roomSchema = tool!.function.parameters.properties.room as {
      required: string[];
    };
    expect(roomSchema.required).toEqual(
      expect.arrayContaining(["id", "roomCode", "roomName", "areaCode", "subAreaCode"])
    );
  });

  it("propose_cancel_reservation의 scope는 single/entire_group만 허용한다 (기본값을 임의로 두지 않음)", () => {
    const tool = toolSchemas.find((t) => t.function.name === "propose_cancel_reservation");
    expect(tool).toBeDefined();
    const scopeSchema = tool!.function.parameters.properties.scope as { enum: string[] };
    expect(scopeSchema.enum).toEqual(["single", "entire_group"]);
  });

  it("읽기 전용 도구(check_availability 등)에는 confirmationToken이 없다", () => {
    const readOnlyNames = ["check_availability", "plan_long_meeting", "recommend_rooms", "get_my_reservations", "find_reservation_candidates"];
    for (const name of readOnlyNames) {
      const tool = toolSchemas.find((t) => t.function.name === name);
      expect(tool).toBeDefined();
      expect(Object.keys(tool!.function.parameters.properties)).not.toContain("confirmationToken");
    }
  });
});
