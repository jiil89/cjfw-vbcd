import { describe, expect, it } from "vitest";
import { parseReserveAllList, parseEventList, isoTimestampToHHmm } from "../availability.tool";

describe("parseReserveAllList -- CJ 원본 reserve_all_list(파이프 구분 문자열) 파싱", () => {
  it("실제 CJ 응답 형태(2026-08-13 실측)를 room_code/slots 쌍으로 분해한다", () => {
    const raw = "4502:NNNYYYYYYYNNYYYYYYYYNNNNNN|4503:NNNNYYYYYYNNNNYYYYYYNNNNNN|";
    expect(parseReserveAllList(raw)).toEqual([
      { room_code: "4502", slots: "NNNYYYYYYYNNYYYYYYYYNNNNNN" },
      { room_code: "4503", slots: "NNNNYYYYYYNNNNYYYYYYNNNNNN" },
    ]);
  });

  it("빈 문자열/undefined/배열(구형 가정) 등 비문자열 입력은 빈 배열을 반환한다", () => {
    expect(parseReserveAllList("")).toEqual([]);
    expect(parseReserveAllList(undefined)).toEqual([]);
    expect(parseReserveAllList([{ room_code: "4502", slots: "NNN" }])).toEqual([]);
  });
});

describe("isoTimestampToHHmm / parseEventList -- CJ event_list의 ISO 타임스탬프 변환", () => {
  it("전체 ISO 타임스탬프에서 HH:mm만 추출한다", () => {
    expect(isoTimestampToHHmm("2026-08-13T08:30:00")).toBe("08:30");
  });

  it("이미 HH:mm 형태면 그대로 반환한다 (하위호환)", () => {
    expect(isoTimestampToHHmm("08:30")).toBe("08:30");
  });

  it("event_list 배열의 resource/start/end를 정규화하고, 필드가 없는 항목은 제외한다", () => {
    const raw = [
      {
        start: "2026-08-13T08:30:00",
        end: "2026-08-13T10:30:00",
        resource: "4502",
      },
      { start: "2026-08-13T07:00:00", end: "2026-08-13T20:00:00", resource: "1111" },
      { start: "2026-08-13T00:00:00" }, // resource/end 없음 -> 제외
    ];
    expect(parseEventList(raw)).toEqual([
      { resource: "4502", start: "08:30", end: "10:30" },
      { resource: "1111", start: "07:00", end: "20:00" },
    ]);
  });

  it("배열이 아니면 빈 배열을 반환한다", () => {
    expect(parseEventList(undefined)).toEqual([]);
    expect(parseEventList("4502:NNN")).toEqual([]);
  });
});
