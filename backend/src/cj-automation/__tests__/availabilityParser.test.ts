// availabilityParser.ts 유닛 테스트.
// 5-project-principle.md §4: 실제 CJ 사이트를 매번 호출하지 않고, 도메인 정의서 9번에
// 정리된 8/13 실사용 스캔 결과를 고정 fixture로 저장해두고 그 fixture로 회귀를 검증한다.

import { describe, expect, it } from "vitest";
import scanFixture from "../__fixtures__/2026-08-13-scan.json";
import { findAvailableRoomCodes, isRoomAvailable } from "../availabilityParser";
import type { AvailabilityGridContext } from "../availabilityParser";

const context: AvailabilityGridContext = {
  reserveAllList: scanFixture.reserveAllList,
  eventList: scanFixture.eventList,
  gridStartTime: scanFixture.gridStartTime,
  slotMinutes: scanFixture.slotMinutes,
};

const expectedAvailable = scanFixture.expectedAvailable as Record<string, boolean>;

describe("availabilityParser — 8/13 14:00~15:00 스캔 fixture", () => {
  it.each(Object.entries(expectedAvailable))(
    "%s 가용성이 fixture의 실사용 결과와 일치한다",
    (roomCode, expected) => {
      const actual = isRoomAvailable(
        context,
        roomCode,
        scanFixture.requestStartTime,
        scanFixture.requestEndTime
      );
      expect(actual).toBe(expected);
    }
  );

  it("12F 전체가 불가로 판정된다 (도메인 정의서 9번 서술)", () => {
    const twelfthFloorRooms = ["12F-1", "12F-2", "12F-3", "12F-4"];
    const available = findAvailableRoomCodes(
      context,
      twelfthFloorRooms,
      scanFixture.requestStartTime,
      scanFixture.requestEndTime
    );
    expect(available).toEqual([]);
  });

  it("3F는 3F-6만 가능하다 (도메인 정의서 9번 서술)", () => {
    const thirdFloorRooms = ["3F-1", "3F-2", "3F-3", "3F-4", "3F-5", "3F-6"];
    const available = findAvailableRoomCodes(
      context,
      thirdFloorRooms,
      scanFixture.requestStartTime,
      scanFixture.requestEndTime
    );
    expect(available).toEqual(["3F-6"]);
  });

  it("그리드는 N(가능)이지만 event_list와 겹치면 불가로 판정한다 (GUBUN 장기점유 케이스, 9번 핵심 발견)", () => {
    expect(isRoomAvailable(context, "13F-1", "14:00", "15:00")).toBe(false);
  });

  it("그리드에 없는 room_code는 데이터 부재로 불가 취급한다", () => {
    expect(isRoomAvailable(context, "9F-1", "14:00", "15:00")).toBe(false);
  });
});
