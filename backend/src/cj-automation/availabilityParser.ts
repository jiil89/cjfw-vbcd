// CJ 자동화 계층 — 가용성 판단 알고리즘 (도메인 정의서 9번 "최종 가용성 판단 알고리즘").
//
// 회의실이 사용 가능하려면 (1) reserve_all_list(그리드)의 해당 시간대 슬롯이 모두 N이고,
// AND (2) event_list에 해당 회의실(resource=room_code)과 시간이 겹치는 항목이 없어야 한다.
// 그리드 단독으로는 GUBUN 0/2 같은 장기 프로젝트성 점유를 놓칠 수 있음이 8/13 실사용
// 스캔으로 확인되었다 (9번).
//
// 이 파일은 CJ 원본 응답을 파싱만 한다 — 비즈니스 규칙(2시간 제한 등)은 모른다.

/** reserve_all_list의 한 회의실 항목. 30분 단위 Y/N 문자열 (Y=예약됨/불가, N=가능). */
export interface CjReserveGridEntry {
  room_code: string;
  /** slots[0]이 gridStartTime이 가리키는 시각의 슬롯. 인덱스 하나당 slotMinutes분. */
  slots: string;
}

/** event_list의 한 항목. resource가 room_code, start/end는 "HH:mm" (같은 날짜 내). */
export interface CjEventListItem {
  resource: string;
  start: string;
  end: string;
}

export interface AvailabilityGridContext {
  reserveAllList: CjReserveGridEntry[];
  eventList: CjEventListItem[];
  /** 그리드 인덱스 0이 가리키는 시각, 예: "07:00" (도메인 정의서 6번 운영시간 시작) */
  gridStartTime: string;
  /** 슬롯 하나의 길이(분), 예약 단위는 30분 (도메인 정의서 6번) */
  slotMinutes: number;
}

function timeToMinutes(hhmm: string): number {
  const [hourStr, minuteStr] = hhmm.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return hour * 60 + minute;
}

/** reserve_all_list 그리드만으로 해당 시간대가 전부 N(가능)인지 확인한다. */
function isGridRangeAvailable(
  entry: CjReserveGridEntry,
  context: AvailabilityGridContext,
  requestStartTime: string,
  requestEndTime: string
): boolean {
  const gridStartMinutes = timeToMinutes(context.gridStartTime);
  const requestStartMinutes = timeToMinutes(requestStartTime);
  const requestEndMinutes = timeToMinutes(requestEndTime);

  const firstSlotIndex = Math.floor(
    (requestStartMinutes - gridStartMinutes) / context.slotMinutes
  );
  const lastSlotIndexExclusive = Math.ceil(
    (requestEndMinutes - gridStartMinutes) / context.slotMinutes
  );

  if (firstSlotIndex < 0 || lastSlotIndexExclusive > entry.slots.length) {
    // 요청 시간대가 그리드 범위를 벗어남 — 이 그리드로는 판단할 수 없으므로 불가로 취급.
    return false;
  }

  for (let index = firstSlotIndex; index < lastSlotIndexExclusive; index += 1) {
    if (entry.slots[index] !== "N") {
      return false;
    }
  }
  return true;
}

/** event_list에 해당 회의실과 시간이 겹치는 항목이 있는지 확인한다 (반열림 구간 [start, end) 겹침 판정). */
function hasOverlappingEvent(
  roomCode: string,
  eventList: CjEventListItem[],
  requestStartTime: string,
  requestEndTime: string
): boolean {
  const requestStartMinutes = timeToMinutes(requestStartTime);
  const requestEndMinutes = timeToMinutes(requestEndTime);

  return eventList.some((event) => {
    if (event.resource !== roomCode) {
      return false;
    }
    const eventStartMinutes = timeToMinutes(event.start);
    const eventEndMinutes = timeToMinutes(event.end);
    return eventStartMinutes < requestEndMinutes && requestStartMinutes < eventEndMinutes;
  });
}

/**
 * 특정 회의실이 요청 시간대에 가용한지 판단한다 (그리드 AND event_list, 9번 알고리즘).
 * room_code가 reserveAllList에 없으면(그리드 데이터 자체가 없으면) 불가로 취급한다.
 */
export function isRoomAvailable(
  context: AvailabilityGridContext,
  roomCode: string,
  requestStartTime: string,
  requestEndTime: string
): boolean {
  const gridEntry = context.reserveAllList.find((entry) => entry.room_code === roomCode);
  if (!gridEntry) {
    return false;
  }

  const gridOk = isGridRangeAvailable(gridEntry, context, requestStartTime, requestEndTime);
  if (!gridOk) {
    return false;
  }

  return !hasOverlappingEvent(roomCode, context.eventList, requestStartTime, requestEndTime);
}

/** 후보 회의실 코드 목록 중 실제로 가용한 것만 걸러낸다. */
export function findAvailableRoomCodes(
  context: AvailabilityGridContext,
  candidateRoomCodes: string[],
  requestStartTime: string,
  requestEndTime: string
): string[] {
  return candidateRoomCodes.filter((roomCode) =>
    isRoomAvailable(context, roomCode, requestStartTime, requestEndTime)
  );
}
