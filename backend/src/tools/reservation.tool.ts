// [레이어 2] 도구 계층 -- 예약 생성. 긴 회의(2시간 초과) 분할 + 보상 트랜잭션 포함.
// 5-project-principle.md 2번: checkRoom -> checkStraightRoom -> checkDayCountLimit -> SaveReserve
// 순서를 여기서 강제한다. CJ 원본 필드명은 client.ts 시그니처(camelCase)로만 다룬다.
//
// 대응 유스케이스 (도메인 정의서 2번): 해피 패스(신규 예약 확정), 긴 회의 요청(회의실 분할 예약).
//
// [미확정 -- 실사용 라이브 테스트 전] checkRoom/checkStraightRoom/checkDayCountLimit/SaveReserve의
// 정확한 성공/실패 응답 스키마는 도메인 정의서 9번에 파라미터만 정리되어 있고 응답 형태는
// 문서화된 적이 없다. isCjCheckAffirmative/extractCjSeq는 최대한 보수적으로 여러 형태
// (boolean/문자열/객체)를 해석하되, 애매하면 통과로 간주하고 최종 게이트인 SaveReserve/DB
// 저장 단계(reservations_no_overlap 등)에서 실패를 잡는다. 실사용 확인 후 도메인 정의서
// 9번과 이 주석을 함께 갱신해야 한다.
import {
  checkDayCountLimit,
  checkRoom,
  checkStraightRoom,
  delReserve,
  saveReserve,
} from "../cj-automation/client";
import { getValidSession, type CjSession } from "../cj-automation/session";
import {
  createReservation as insertReservationRow,
  RoomAlreadyBookedError,
} from "../db/repositories/reservationRepository";
import {
  createReservationRequest,
  linkReservationRequestToReservation,
} from "../db/repositories/reservationRequestRepository";
import type { Room } from "../db/repositories/roomRepository";
import {
  assertValidReservationWindow,
  BusinessRuleViolationError,
  durationMinutes,
  MAX_SINGLE_ROOM_MINUTES,
  RESERVATION_UNIT_MINUTES,
} from "./businessRules";
import { findAvailableRooms, resolveEmailAlias } from "./availability.tool";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 요청 분(minutes)을 2시간(MAX_SINGLE_ROOM_MINUTES) 이하 세그먼트로 분할한다
 * (도메인 정의서 2번 "긴 회의 요청"). 앞쪽 세그먼트부터 최대 120분씩 채우고
 * 남는 시간을 마지막 세그먼트에 배정한다. totalMinutes는 30분 단위 양수여야 한다.
 *
 * 예: 180분(3시간) -> [120, 60]. 300분(5시간) -> [120, 120, 60]
 */
export function splitIntoSegments(totalMinutes: number): number[] {
  if (totalMinutes <= 0 || totalMinutes % RESERVATION_UNIT_MINUTES !== 0) {
    throw new BusinessRuleViolationError(
      `분할 대상 시간은 ${RESERVATION_UNIT_MINUTES}분 단위의 양수여야 합니다: ${totalMinutes}`
    );
  }
  const segments: number[] = [];
  let remaining = totalMinutes;
  while (remaining > 0) {
    const units = Math.min(remaining, MAX_SINGLE_ROOM_MINUTES);
    segments.push(units);
    remaining -= units;
  }
  return segments;
}

function addMinutesToTime(hhmm: string, minutesToAdd: number): string {
  const [hourStr, minuteStr] = hhmm.split(":");
  const totalMinutes = Number(hourStr) * 60 + Number(minuteStr) + minutesToAdd;
  const hour = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minute = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}
/** true를 반환하면 이 검증을 통과했다(문제 없음)는 뜻으로 해석한다. */
function isCjCheckAffirmative(raw: unknown): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toUpperCase();
    if (normalized === "N" || normalized === "FALSE" || normalized === "FAIL" || normalized === "") {
      return false;
    }
    return true;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.success === "boolean") return obj.success;
    if (typeof obj.Success === "boolean") return obj.Success;
    if (typeof obj.result === "boolean") return obj.result;
  }
  return true;
}
function extractCjSeq(raw: unknown): string {
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.trim();
  }
  if (typeof raw === "number") {
    return String(raw);
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["seq", "Seq", "SEQ", "d"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number") return String(value);
    }
  }
  throw new Error("[tools/reservation] SaveReserve 응답에서 예약 고유번호(seq)를 확인하지 못했습니다.");
}

export class ReservationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationConflictError";
  }
}
interface SaveOneSegmentParams {
  session: CjSession;
  emailAlias: string;
  room: Room;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  contents: string;
  phoneNum: string;
}

async function saveOneSegmentToCj(params: SaveOneSegmentParams): Promise<string> {
  const { session, room } = params;

  const roomCheck = await checkRoom(session, {
    floorCode: room.subAreaCode,
    roomCode: room.roomCode,
    startDate: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
  });
  if (!isCjCheckAffirmative(roomCheck)) {
    throw new ReservationConflictError(
      `${room.roomName} ${params.startTime}~${params.endTime}은 이미 다른 예약과 겹칩니다.`
    );
  }

  const straightCheck = await checkStraightRoom(session, {
    floorCode: room.subAreaCode,
    roomCode: room.roomCode,
    startDate: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    emailAlias: params.emailAlias,
  });
  if (!isCjCheckAffirmative(straightCheck)) {
    throw new ReservationConflictError(`${room.roomName}은 같은 회의실 하루 누적 2시간 제한을 초과합니다.`);
  }

  const dayCountCheck = await checkDayCountLimit(session, {
    roomCode: room.roomCode,
    startDate: params.date,
    emailAlias: params.emailAlias,
  });
  if (!isCjCheckAffirmative(dayCountCheck)) {
    throw new ReservationConflictError("일일 예약 가능 건수 제한을 초과했습니다.");
  }

  const saveResult = await saveReserve(session, {
    buildingCode: room.areaCode,
    floorCode: room.subAreaCode,
    roomCode: room.roomCode,
    roomName: room.roomName,
    reserveDate: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    title: params.title,
    contents: params.contents,
    phoneNum: params.phoneNum,
    isSendMail: false,
    reserveType: "I",
  });

  return extractCjSeq(saveResult);
}
async function compensateCreatedCjReservations(session: CjSession, cjSeqs: string[]): Promise<void> {
  for (const cjSeq of cjSeqs) {
    await delReserve(session, cjSeq).catch((err) => {
      console.error(`[tools/reservation] 보상 취소(delReserve) 실패: seq=${cjSeq}`, err);
    });
  }
}

export class SegmentReservationFailedError extends Error {
  constructor(
    message: string,
    public readonly failedSegmentIndex: number,
    public readonly compensatedCjSeqs: string[]
  ) {
    super(message);
    this.name = "SegmentReservationFailedError";
  }
}
export interface CreateReservationInput {
  title: string;
  contents: string;
  phoneNum: string;
  date: string;
  startTime: string;
  endTime: string;
  room: Room;
}

export interface CreatedReservationSummary {
  reservationId: string;
  roomName: string;
  startTime: string;
  endTime: string;
  cjSeq: string;
}

function toTimestamp(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00`;
}

export async function createReservation(
  userId: string,
  input: CreateReservationInput,
  today?: string
): Promise<CreatedReservationSummary> {
  const effectiveToday = today ?? isoToday();
  assertValidReservationWindow({
    date: input.date,
    today: effectiveToday,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  const totalMinutes = durationMinutes(input.startTime, input.endTime);
  if (totalMinutes > MAX_SINGLE_ROOM_MINUTES) {
    throw new BusinessRuleViolationError(
      `${MAX_SINGLE_ROOM_MINUTES}분을 초과하는 요청은 분할 예약(createSplitReservation)을 사용해야 합니다.`
    );
  }

  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  const request = await createReservationRequest({
    userId,
    title: input.title,
    contents: input.contents || null,
    desiredDate: input.date,
    desiredStartTime: input.startTime,
    desiredEndTime: input.endTime,
  });

  let cjSeq: string;
  try {
    cjSeq = await saveOneSegmentToCj({
      session,
      emailAlias,
      room: input.room,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      title: input.title,
      contents: input.contents,
      phoneNum: input.phoneNum,
    });
  } catch (err) {
    throw err instanceof ReservationConflictError
      ? err
      : new ReservationConflictError(
          `${input.room.roomName} 예약 생성 중 CJ 시스템 오류가 발생했습니다: ${(err as Error).message}`
        );
  }

  try {
    const reservation = await insertReservationRow({
      reservationRequestId: request.id,
      userId,
      roomId: input.room.id,
      cjSeq,
      title: input.title,
      contents: input.contents || null,
      startAt: toTimestamp(input.date, input.startTime),
      endAt: toTimestamp(input.date, input.endTime),
    });
    await linkReservationRequestToReservation(request.id, reservation.id);

    return {
      reservationId: reservation.id,
      roomName: input.room.roomName,
      startTime: input.startTime,
      endTime: input.endTime,
      cjSeq,
    };
  } catch (err) {
    await compensateCreatedCjReservations(session, [cjSeq]);
    throw err;
  }
}
export interface SegmentTimeWindow {
  startTime: string;
  endTime: string;
}

export function buildSegmentTimeWindows(startTime: string, segmentMinutes: number[]): SegmentTimeWindow[] {
  const windows: SegmentTimeWindow[] = [];
  let cursor = startTime;
  for (const minutes of segmentMinutes) {
    const end = addMinutesToTime(cursor, minutes);
    windows.push({ startTime: cursor, endTime: end });
    cursor = end;
  }
  return windows;
}

export interface RoomedSegmentPlan extends SegmentTimeWindow {
  room: Room;
}

export interface LongMeetingPlanResult {
  segments: RoomedSegmentPlan[];
  unavailableReason?: string;
}

export async function planLongMeetingSegments(
  userId: string,
  params: { date: string; startTime: string; endTime: string; minCapacity?: number },
  today?: string
): Promise<LongMeetingPlanResult> {
  const effectiveToday = today ?? isoToday();
  assertValidReservationWindow({
    date: params.date,
    today: effectiveToday,
    startTime: params.startTime,
    endTime: params.endTime,
  });

  const totalMinutes = durationMinutes(params.startTime, params.endTime);
  if (totalMinutes <= MAX_SINGLE_ROOM_MINUTES) {
    throw new BusinessRuleViolationError(
      `${MAX_SINGLE_ROOM_MINUTES}분 이하 요청은 분할 대상이 아닙니다: ${totalMinutes}분`
    );
  }

  const segmentMinutes = splitIntoSegments(totalMinutes);
  const windows = buildSegmentTimeWindows(params.startTime, segmentMinutes);

  const usedRoomIds = new Set<string>();
  let preferredFloorLabel: string | null = null;
  const roomedSegments: RoomedSegmentPlan[] = [];

  for (const window of windows) {
    const availability = await findAvailableRooms(
      userId,
      {
        date: params.date,
        startTime: window.startTime,
        endTime: window.endTime,
        minCapacity: params.minCapacity,
      },
      effectiveToday
    );
    const candidates = [...availability.preferred, ...availability.others].filter(
      (room) => !usedRoomIds.has(room.id)
    );

    if (candidates.length === 0) {
      return {
        segments: [],
        unavailableReason: `${window.startTime}~${window.endTime} 구간에 배정 가능한(아직 쓰이지 않은) 회의실이 없습니다.`,
      };
    }

    const sameFloor: Room[] = preferredFloorLabel
      ? candidates.filter((room) => room.floorLabel === preferredFloorLabel)
      : [];
    const chosen: Room = sameFloor[0] ?? candidates[0];

    usedRoomIds.add(chosen.id);
    preferredFloorLabel = chosen.floorLabel;
    roomedSegments.push({ ...window, room: chosen });
  }

  return { segments: roomedSegments };
}
export async function createSplitReservation(
  userId: string,
  input: { title: string; contents: string; phoneNum: string; date: string; plan: RoomedSegmentPlan[] },
  today?: string
): Promise<CreatedReservationSummary[]> {
  if (input.plan.length < 2) {
    throw new BusinessRuleViolationError("분할 예약 계획은 2개 이상의 세그먼트가 필요합니다.");
  }

  const overallStart = input.plan[0].startTime;
  const overallEnd = input.plan[input.plan.length - 1].endTime;
  const effectiveToday = today ?? isoToday();
  assertValidReservationWindow({
    date: input.date,
    today: effectiveToday,
    startTime: overallStart,
    endTime: overallEnd,
  });

  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  const request = await createReservationRequest({
    userId,
    title: input.title,
    contents: input.contents || null,
    desiredDate: input.date,
    desiredStartTime: overallStart,
    desiredEndTime: overallEnd,
  });

  const createdCjSeqs: string[] = [];
  const createdSummaries: CreatedReservationSummary[] = [];

  for (let index = 0; index < input.plan.length; index += 1) {
    const segment = input.plan[index];
    try {
      const cjSeq = await saveOneSegmentToCj({
        session,
        emailAlias,
        room: segment.room,
        date: input.date,
        startTime: segment.startTime,
        endTime: segment.endTime,
        title: input.title,
        contents: input.contents,
        phoneNum: input.phoneNum,
      });
      createdCjSeqs.push(cjSeq);

      const reservation = await insertReservationRow({
        reservationRequestId: request.id,
        userId,
        roomId: segment.room.id,
        cjSeq,
        title: input.title,
        contents: input.contents || null,
        startAt: toTimestamp(input.date, segment.startTime),
        endAt: toTimestamp(input.date, segment.endTime),
      });

      createdSummaries.push({
        reservationId: reservation.id,
        roomName: segment.room.roomName,
        startTime: segment.startTime,
        endTime: segment.endTime,
        cjSeq,
      });
    } catch (err) {
      await compensateCreatedCjReservations(session, createdCjSeqs);
      const message =
        err instanceof RoomAlreadyBookedError || err instanceof ReservationConflictError
          ? err.message
          : `${segment.room.roomName} ${segment.startTime}~${segment.endTime} 예약 생성 중 오류가 발생했습니다.`;
      throw new SegmentReservationFailedError(
        `분할 예약 중 ${index + 1}번째 구간(${segment.room.roomName} ${segment.startTime}~${segment.endTime})에서 실패해 전체를 취소했습니다: ${message}`,
        index,
        createdCjSeqs
      );
    }
  }

  return createdSummaries;
}
