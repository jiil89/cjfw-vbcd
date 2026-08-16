// client.ts의 saveReserve가 CJ에 보내는 실제 요청 본문을 검증한다.
// [20260816] 비상 연락처(phone_num)는 어떤 상위 계층이 무엇을 하든 항상 빈 문자열로
// 저장되어야 한다는 요구사항 — SaveReserveParams에서 phoneNum 필드 자체를 없애고
// callCjApi로 보내는 요청 본문에 "" 를 하드코딩했다. 이 테스트는 그 하드코딩이
// 실제 HTTP 요청 바디에 반영되는지 확인한다(타입 레벨 보장만으로는 실제 전송 값까지
// 보장되지 않으므로).

import { describe, expect, it, vi } from "vitest";
import { saveReserve } from "../client";
import type { CjSession } from "../session";

function fakeSession(): CjSession {
  return { cookieHeader: "ASP.NET_SessionId=abc", baseUrl: "https://cjwappr.cj.net" };
}

describe("saveReserve -- 비상 연락처(phone_num)는 항상 빈 문자열로 전송된다", () => {
  it("SaveReserveParams에 phoneNum 필드가 없어도(타입에서 제거됨) 요청 본문의 phone_num은 항상 빈 문자열이다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(JSON.stringify({ Result: "1", seq: "1001" }), "utf-8"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveReserve(fakeSession(), {
      buildingCode: "804",
      floorCode: "1128",
      roomCode: "4539",
      roomName: "3F-1",
      reserveDate: "2026-08-17",
      startTime: "10:00",
      endTime: "11:00",
      title: "주간회의",
      contents: "주간회의",
      isSendMail: "0",
      attendeeCount: "",
      gubun: 0,
      reqList: "",
      optList: "",
      isSendAlarm: "False",
      adminAlias: "",
      adminLang: "",
      reserveType: "I",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.phone_num).toBe("");

    vi.unstubAllGlobals();
  });
});
