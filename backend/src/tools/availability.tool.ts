// [레이어 2] 도구 계층 — 가용성 조회 + 선호 회의실 우선순위 + 조건검색(인원수/층) + 이력기반추천.
// 5-project-principle.md §2: 이 계층이 CJ 자동화 계층(session/client)과 DB 리포지토리를 호출한다.
// 원본 CJ 필드명(area_code, room_code 등)은 여기서 우리 도메인 이름으로 이미 정리된
// client.ts 시그니처를 그대로 쓰고, 위 계층(orchestration)에는 Room(우리 DB 타입)만 넘긴다.
//
// 대응 유스케이스 (도메인 정의서 2번): 해피 패스, 조건(인원수 등) 검색, 이력 기반 추천.

import { getDayPilotConfReserveList } from "../cj-automation/client";
import type { CjEventListItem, CjReserveGridEntry } from "../cj-automation/availabilityParser";
import { findAvailableRoomCodes, type AvailabilityGridContext } from "../cj-automation/availabilityParser";
import { getValidSession } from "../cj-automation/session";
import { findFrequentRoomIdsByUserId } from "../db/repositories/reservationRepository";
import { findBookableRooms, findRoomsByIds } from "../db/repositories/roomRepository";
import type { Room } from "../db/repositories/roomRepository";
import { findUserById } from "../db/repositories/userRepository";
import { findPreferredRoomsByUserId } from "../db/repositories/userPreferredRoomRepository";
import { assertValidReservationWindow, RESERVATION_UNIT_MINUTES } from "./businessRules";
import { toKstDate } from "../lib/kst";

// 가용성 그리드는 07:00부터 30분 단위로 시작한다 (도메인 정의서 6번 운영시간/예약단위).
const GRID_START_TIME = "07:00";

// [버그 수정, 20260818] UTC 기본값이면 한국시간 00:00~08:59 사이 정확히 7일 뒤 조회가
// 부당하게 "범위 밖"으로 거부된다. check_availability의 기본 오늘이라 실사용 영향이 크다.
function todayDateString(): string {
  return toKstDate(new Date());
}

/**
 * CJ getDayPilotConfReserveList 원본 응답을 availabilityParser가 이해하는 정규화된
 * 그리드 컨텍스트 조각으로 변환한다.
 *
 * [2026-08-13 실측으로 정정] `reserve_all_list`는 JSON 배열이 아니라 방 코드별
 * 30분 단위 Y/N 문자열을 "|"로 이어붙인 단일 문자열이다:
 * `"4502:NNNYYYYYYYNNYYYYYYYYNNNNNN|4503:NNNN...|"` — `room_code:slots` 쌍을 "|"로 구분.
 * `event_list`의 `start`/`end`는 "HH:mm"이 아니라 전체 ISO 타임스탬프
 * (`"2026-08-13T08:30:00"`)다. 둘 다 여기서 availabilityParser가 기대하는 형태로
 * 변환한다 — 원본 형태가 또 바뀌면 이 함수만 고치면 된다.
 */
export function parseReserveAllList(raw: unknown): CjReserveGridEntry[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw
    .split("|")
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf(":");
      if (separatorIndex === -1) return { room_code: chunk, slots: "" };
      return {
        room_code: chunk.slice(0, separatorIndex),
        slots: chunk.slice(separatorIndex + 1),
      };
    });
}

/** "2026-08-13T08:30:00" -> "08:30". 이미 "HH:mm"이면 그대로 반환한다. */
export function isoTimestampToHHmm(value: string): string {
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : value;
}

export function parseEventList(raw: unknown): CjEventListItem[] {
  if (!Array.isArray(raw)) return [];
  const result: CjEventListItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.resource !== "string" ||
      typeof record.start !== "string" ||
      typeof record.end !== "string"
    ) {
      continue;
    }
    result.push({
      resource: record.resource,
      start: isoTimestampToHHmm(record.start),
      end: isoTimestampToHHmm(record.end),
    });
  }
  return result;
}

function normalizeGridResponse(raw: {
  reserve_all_list?: unknown;
  event_list?: unknown;
}): { reserveAllList: CjReserveGridEntry[]; eventList: CjEventListItem[] } {
  return {
    reserveAllList: parseReserveAllList(raw.reserve_all_list),
    eventList: parseEventList(raw.event_list),
  };
}

/** 후보 회의실들을 소속 층(subAreaCode)별로 묶어 CJ 가용성 조회를 층당 1회로 최소화한다. */
async function fetchGridContextForRooms(
  session: Awaited<ReturnType<typeof getValidSession>>,
  emailAlias: string,
  date: string,
  candidateRooms: Room[]
): Promise<AvailabilityGridContext> {
  const floorCodes = [...new Set(candidateRooms.map((room) => room.subAreaCode))];

  const reserveAllList: CjReserveGridEntry[] = [];
  const eventList: CjEventListItem[] = [];

  for (const floorCode of floorCodes) {
    const raw = await getDayPilotConfReserveList(session, {
      areaList: floorCode,
      reserveDate: date,
      emailAlias,
    });
    const normalized = normalizeGridResponse(raw);
    reserveAllList.push(...normalized.reserveAllList);
    eventList.push(...normalized.eventList);
  }

  return { reserveAllList, eventList, gridStartTime: GRID_START_TIME, slotMinutes: RESERVATION_UNIT_MINUTES };
}

export interface FindAvailableRoomsParams {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  /** 조건 검색: 최소 수용 인원 (도메인 정의서 2번 "조건 검색") */
  minCapacity?: number;
  /** 조건 검색: 특정 층으로 한정 (예: "12F") */
  floorLabel?: string;
}

export interface AvailabilityResult {
  /** 선호 회의실 중 가용한 것 (등록된 우선순위 순서 그대로) */
  preferred: Room[];
  /** 선호 목록 밖(또는 선호 회의실 미등록)이지만 가용한 나머지 회의실 */
  others: Room[];
}

/**
 * 해피 패스 + 조건 검색 공용 진입점. userId의 CJ 세션으로 실시간 가용성을 조회하고,
 * 선호 회의실을 먼저 확인한 뒤(도메인 정의서 2번 "해피 패스" 2단계), 나머지 가용
 * 회의실을 함께 반환한다 — "선호 회의실이 다 찼으면 곧바로 대안을 함께 제시" 원칙
 * (도메인 정의서 6번 "[결정됨]")에 따라 항상 두 목록을 함께 돌려주고 호출자가 조합한다.
 */
export async function findAvailableRooms(
  userId: string,
  params: FindAvailableRoomsParams,
  today: string = todayDateString()
): Promise<AvailabilityResult> {
  assertValidReservationWindow({
    date: params.date,
    today,
    startTime: params.startTime,
    endTime: params.endTime,
  });

  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  const bookableRooms = await findBookableRooms();
  const candidateRooms = bookableRooms.filter((room) => {
    if (params.minCapacity != null && (room.capacity == null || room.capacity < params.minCapacity)) {
      return false;
    }
    if (params.floorLabel != null && room.floorLabel !== params.floorLabel) {
      return false;
    }
    return true;
  });

  if (candidateRooms.length === 0) {
    return { preferred: [], others: [] };
  }

  const context = await fetchGridContextForRooms(session, emailAlias, params.date, candidateRooms);
  const availableRoomCodes = new Set(
    findAvailableRoomCodes(
      context,
      candidateRooms.map((room) => room.roomCode),
      params.startTime,
      params.endTime
    )
  );

  const availableRooms = candidateRooms.filter((room) => availableRoomCodes.has(room.roomCode));

  const preferredRoomsOrdered = await findPreferredRoomsByUserId(userId);
  const preferredRoomIds = new Set(preferredRoomsOrdered.map((room) => room.id));

  const preferred = preferredRoomsOrdered.filter((room) => availableRoomCodes.has(room.roomCode));
  const others = availableRooms.filter((room) => !preferredRoomIds.has(room.id));

  return { preferred, others };
}

/**
 * 이력 기반 추천 ("자주 쓰던 회의실", 도메인 정의서 2번). 등록된 선호 회의실이 있으면
 * 그것을 그대로 1순위로 사용하고, 없으면 취소되지 않은 과거 예약을 집계해 예약 횟수가
 * 많은 순으로 반환한다 (get_user_frequent_rooms).
 */
export async function recommendRoomsForUser(userId: string, limit = 3): Promise<Room[]> {
  const preferred = await findPreferredRoomsByUserId(userId);
  if (preferred.length > 0) {
    return preferred;
  }

  const frequent = await findFrequentRoomIdsByUserId(userId, limit);
  return findRoomsByIds(frequent.map((entry) => entry.roomId));
}

/**
 * [BE-7 추가 — 기존 함수 변경 없음] 오케스트레이션(LLM) 계층이 시스템 프롬프트에 넣을
 * "예약 가능한 회의실 목록"(회의실명/층/수용인원)을 조회하기 위한 얇은 재노출 함수.
 * 5-project-principle.md §2: 오케스트레이션 계층은 db/cj-automation을 직접 알지 못하고
 * tools/ 계층 함수만 호출해야 하므로, 이미 이 파일이 쓰는 findBookableRooms를 그대로
 * 감싸서 내보낸다 (새 로직 없음, 기존 findAvailableRooms/recommendRoomsForUser 동작에는
 * 영향 없음).
 */
export async function listBookableRoomsForContext(): Promise<Room[]> {
  return findBookableRooms();
}

// userId -> email_alias 조회는 여러 도구 파일이 공통으로 필요해 이 파일에 한 번만 두고
// 다른 tools 파일에서 재사용한다 (findUserById는 이미 session.ts가 로그인용으로 쓴다).
export async function resolveEmailAlias(userId: string): Promise<string> {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error(`[tools/availability] 사용자를 찾을 수 없습니다: ${userId}`);
  }
  return user.emailAlias;
}
