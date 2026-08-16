// [레이어 2] 도구 계층 -- 예약 변경.
// 도메인 정의서 2번 "예약 변경": 대상이 모호하면(후보 여러 건) 바로 진행하지 않고 되묻는다
// (reservationTargeting.ts). 변경 실행 전략은 도메인 정의서 8번 Open Question(SaveReserve의
// 수정 모드 지원 여부 미확인) 때문에, 실사용 라이브 테스트로 확인되기 전까지는 더 안전한
// "delReserve(취소) 후 saveReserve(재생성)" 전략을 쓰고, 재생성이 실패하면 원래 예약
// 정보로 재시도하는 보상 로직을 둔다 (도메인 정의서 2번 6단계에 명시된 위험 대응).
//
// [미확정] checkRoom/checkStraightRoom/checkDayCountLimit가 받는 seq 파라미터가 "자기
// 자신을 검증에서 제외"하는 용도인지는 신규 생성 흐름에서만 확인됐고 변경 흐름에서는
// 아직 라이브 테스트한 적이 없다(도메인 정의서 8번). 이 파일은 그 가정을 그대로 적용해
// seq를 넘기지만, 실사용 확인 후 도메인 정의서 9번/8번과 함께 갱신해야 한다.
//
// [2026-08-16 실사용 버그 — CJ checkRoom을 신뢰하면 안 된다] 사용자가 14F-3 예약을
// 09:00~10:00으로 변경하려다 실패했다. 라이브로 직접 확인해보니:
//   - 우리 자체 가용성 판정(findAvailableRooms)  : 14F-3 09:00~10:00 **불가** (정확)
//   - CJ checkRoom                              : Result:"1" = **가능이라고 거짓 응답**
//   - 실제 SaveReserve                          : Result:0 실패
// 즉 CJ의 checkRoom은 이미 점유된 슬롯도 "가능"이라고 답한다. 이 파일은 checkRoom만 믿고
// **원본을 delReserve로 먼저 지운 뒤** saveReserve를 시도하는 구조라, 이 거짓 응답이
// 그대로 "원본 삭제 → 재생성 실패 → 원본 복구"라는 위험한 왕복으로 이어졌다. 그래서
// delReserve 하기 전에 우리 자체 가용성 판정으로 한 번 더 막는다(아래 assertTargetSlotIsFree).
import { checkDayCountLimit, checkRoom, checkStraightRoom, delReserve, saveReserve } from "../cj-automation/client";
import { getValidSession, type CjSession } from "../cj-automation/session";
import {
  findReservationById,
  findReservationsByRequestId,
  markReservationModified,
  RoomAlreadyBookedError,
} from "../db/repositories/reservationRepository";
import { findRoomById } from "../db/repositories/roomRepository";
import type { Room } from "../db/repositories/roomRepository";
import { findAvailableRooms, resolveEmailAlias } from "./availability.tool";
import { assertValidReservationWindow, BusinessRuleViolationError } from "./businessRules";
import { fetchRoomOptionInfo, ReservationConflictError } from "./reservation.tool";
import { ReservationNotFoundError } from "./reservationTargeting";
import { toKstDate, toKstHHmm, toKstTimestamp } from "../lib/kst";

export { resolveSingleReservationTarget, findReservationCandidates } from "./reservationTargeting";

/** 분할 예약(긴 회의) 그룹의 일부인 예약 변경은 이번 범위에서 지원하지 않는다 --
 * 연결된 모든 세그먼트를 함께 다뤄야 하는데(도메인 정의서 2번 8단계), 그 재계획 로직은
 * 별도로 설계가 필요하다. 지금은 사용자에게 명확히 안내하고 거부하는 것으로 대체한다
 * (오버엔지니어링 금지 -- 실제 요청이 나오면 그때 확장한다). */
export class SplitGroupModifyNotSupportedError extends Error {
  constructor(
    message = "분할 예약(여러 회의실로 나뉜 연속 회의)의 변경은 아직 지원하지 않습니다. 취소 후 다시 예약해 주세요."
  ) {
    super(message);
    this.name = "SplitGroupModifyNotSupportedError";
  }
}

export class ReservationModifyFailedError extends Error {
  constructor(
    message: string,
    public readonly originalReservationRestored: boolean
  ) {
    super(message);
    this.name = "ReservationModifyFailedError";
  }
}

export interface ModifyReservationParams {
  reservationId: string;
  newRoom?: Room;
  newDate?: string;
  newStartTime?: string;
  newEndTime?: string;
}

export interface ModifiedReservationSummary {
  reservationId: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  cjSeq: string;
}
function isAffirmative(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toUpperCase();
    return !(normalized === "N" || normalized === "FALSE" || normalized === "FAIL" || normalized === "");
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.success === "boolean") return obj.success;
    if (typeof obj.Success === "boolean") return obj.Success;
    if (typeof obj.result === "boolean") return obj.result;
  }
  return true;
}

function extractSeq(raw: unknown): string {
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["seq", "Seq", "SEQ", "d"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number") return String(value);
    }
  }
  throw new Error("[tools/modifyReservation] SaveReserve 응답에서 예약 고유번호(seq)를 확인하지 못했습니다.");
}

function splitTimestamp(ts: string): { date: string; time: string } {
  return { date: toKstDate(ts), time: toKstHHmm(ts) };
}

/** "HH:mm" 두 구간이 겹치는지. */
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 변경하려는 슬롯이 **우리 자체 가용성 판정 기준으로** 실제 비어 있는지 확인한다.
 *
 * CJ의 checkRoom이 이미 점유된 슬롯도 "가능"이라고 답하는 게 실사용에서 확인됐기 때문에
 * (파일 상단 주석), delReserve로 원본을 지우기 **전에** 여기서 먼저 막는다. 이렇게 해야
 * "원본 삭제 → 재생성 실패 → 복구" 왕복 자체가 일어나지 않고, 사용자에게도 실패 사유를
 * 정확히 알려줄 수 있다("그 시간엔 이미 다른 예약이 있어요").
 *
 * 단, 변경 대상 예약 **자기 자신**이 그 슬롯을 점유하고 있는 경우(같은 회의실에서 시간만
 * 조금 늘리는 등)는 충돌로 보면 안 된다 — 같은 회의실이면서 원래 시간대와 겹칠 때는
 * 이 검사를 건너뛴다.
 */
async function assertTargetSlotIsFree(params: {
  userId: string;
  newRoom: Room;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  originalRoomId: string;
  originalDate: string;
  originalStartTime: string;
  originalEndTime: string;
}): Promise<void> {
  const isSameRoom = params.newRoom.id === params.originalRoomId;
  const isSameDate = params.newDate === params.originalDate;
  if (
    isSameRoom &&
    isSameDate &&
    timeRangesOverlap(params.newStartTime, params.newEndTime, params.originalStartTime, params.originalEndTime)
  ) {
    // 자기 자신과 겹치는 변경(같은 방에서 시간 연장/축소 등) — 여기서 판정할 수 없으므로
    // 기존 CJ 검증 + SaveReserve 결과에 맡긴다.
    return;
  }

  const available = await findAvailableRooms(params.userId, {
    date: params.newDate,
    startTime: params.newStartTime,
    endTime: params.newEndTime,
  });
  const isFree = [...available.preferred, ...available.others].some((room) => room.id === params.newRoom.id);
  if (!isFree) {
    throw new ReservationConflictError(
      `${params.newRoom.roomName}은 ${params.newDate} ${params.newStartTime}~${params.newEndTime}에 이미 다른 예약이 있어요.`
    );
  }
}

/**
 * [2026-08-14 실사용 검증 완료] gubun/is_send_alarm/admin_alias/admin_lang을 회의실별로
 * getEmptyRoomInfo에서 동적으로 채운다(reservation.tool.ts와 동일 이유 — client.ts의
 * GetEmptyRoomInfoResponse 주석 참고). SaveReserve 응답의 Result 필드도 명시적으로 확인한다
 * (기존엔 이 확인이 없어서 실패해도 extractSeq가 우연히 뭔가를 뽑아내면 성공으로 오판할
 * 여지가 있었다).
 */
async function saveReserveChecked(
  session: CjSession,
  room: Room,
  params: { date: string; startTime: string; endTime: string; title: string; contents: string }
): Promise<string> {
  const roomOption = await fetchRoomOptionInfo(session, {
    roomCode: room.roomCode,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
  });

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
    isSendMail: "0",
    attendeeCount: "",
    gubun: roomOption.gubun,
    reqList: "",
    optList: "",
    isSendAlarm: roomOption.isSendAlarm,
    adminAlias: roomOption.adminAlias,
    adminLang: roomOption.adminLang,
    reserveType: "I",
  });

  const resultObj = saveResult && typeof saveResult === "object" ? (saveResult as Record<string, unknown>) : {};
  if (resultObj.Result !== "1" && resultObj.Result !== 1) {
    console.error(`[tools/modifyReservation] SaveReserve Result≠1(실패로 판정): ${JSON.stringify(saveResult)}`);
    throw new ReservationConflictError(`${room.roomName} 예약 저장이 CJ 시스템에서 거부되었습니다.`);
  }

  return extractSeq(saveResult);
}

/**
 * 예약을 변경한다. reservationId는 이미 사용자와 확인을 마친(모호하지 않게 특정된)
 * 대상이어야 한다. 회의실만/시간만/둘 다 변경 모두 이 함수 하나로 처리한다 -- newRoom을
 * 안 주면 기존 회의실 유지, newDate/newStartTime/newEndTime을 안 주면 기존 시간 유지.
 */
export async function modifyReservation(
  userId: string,
  params: ModifyReservationParams,
  today?: string
): Promise<ModifiedReservationSummary> {
  const reservation = await findReservationById(params.reservationId);
  if (!reservation || reservation.userId !== userId) {
    throw new ReservationNotFoundError();
  }
  if (reservation.status === "cancelled") {
    throw new BusinessRuleViolationError("이미 취소된 예약은 변경할 수 없습니다.");
  }

  if (reservation.reservationRequestId) {
    const group = await findReservationsByRequestId(reservation.reservationRequestId);
    const activeGroup = group.filter((entry) => entry.status !== "cancelled");
    if (activeGroup.length > 1) {
      throw new SplitGroupModifyNotSupportedError();
    }
  }

  const original = splitTimestamp(reservation.startAt);
  const originalEnd = splitTimestamp(reservation.endAt);

  const newRoom = params.newRoom ?? (await findRoomById(reservation.roomId));
  if (!newRoom) {
    throw new Error(`[tools/modifyReservation] 회의실을 찾지 못했습니다: ${reservation.roomId}`);
  }
  const newDate = params.newDate ?? original.date;
  const newStartTime = params.newStartTime ?? original.time;
  const newEndTime = params.newEndTime ?? originalEnd.time;

  assertValidReservationWindow({
    date: newDate,
    today: today ?? new Date().toISOString().slice(0, 10),
    startTime: newStartTime,
    endTime: newEndTime,
  });

  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  // seq(reservation.cjSeq)를 검증 API에 함께 넘겨 "자기 자신"은 충돌/누적시간 계산에서
  // 제외되기를 기대한다 (도메인 정의서 8번 Open Question, 변경 흐름에서는 미확인).
  const roomCheck = await checkRoom(session, {
    floorCode: newRoom.subAreaCode,
    roomCode: newRoom.roomCode,
    startDate: newDate,
    startTime: newStartTime,
    endTime: newEndTime,
    seq: reservation.cjSeq ?? undefined,
  });
  if (!isAffirmative(roomCheck)) {
    throw new ReservationConflictError(`${newRoom.roomName} ${newStartTime}~${newEndTime}은 이미 다른 예약과 겹칩니다.`);
  }

  const straightCheck = await checkStraightRoom(session, {
    floorCode: newRoom.subAreaCode,
    roomCode: newRoom.roomCode,
    startDate: newDate,
    startTime: newStartTime,
    endTime: newEndTime,
    emailAlias,
    seq: reservation.cjSeq ?? undefined,
  });
  if (!isAffirmative(straightCheck)) {
    throw new ReservationConflictError(`${newRoom.roomName}은 같은 회의실 하루 누적 2시간 제한을 초과합니다.`);
  }

  const dayCountCheck = await checkDayCountLimit(session, {
    roomCode: newRoom.roomCode,
    startDate: newDate,
    emailAlias,
    seq: reservation.cjSeq ?? undefined,
  });
  if (!isAffirmative(dayCountCheck)) {
    throw new ReservationConflictError("일일 예약 가능 건수 제한을 초과했습니다.");
  }

  // [2026-08-16] CJ checkRoom이 거짓으로 "가능"을 답하는 게 확인됐으므로(파일 상단 주석),
  // 원본을 지우기 전에 우리 자체 가용성 판정으로 한 번 더 막는다. 이 검사가 없으면
  // "원본 삭제 → 재생성 실패 → 복구"라는 위험한 왕복이 그대로 일어난다.
  await assertTargetSlotIsFree({
    userId,
    newRoom,
    newDate,
    newStartTime,
    newEndTime,
    originalRoomId: reservation.roomId,
    originalDate: original.date,
    originalStartTime: original.time,
    originalEndTime: originalEnd.time,
  });

  // "delReserve 후 saveReserve" 전략 (파일 상단 주석 -- 8번 Open Question).
  if (reservation.cjSeq) {
    await delReserve(session, reservation.cjSeq);
  }

  let newCjSeq: string;
  try {
    newCjSeq = await saveReserveChecked(session, newRoom, {
      date: newDate,
      startTime: newStartTime,
      endTime: newEndTime,
      title: reservation.title,
      contents: reservation.contents ?? "",
    });
  } catch (err) {
    const originalRoom = await findRoomById(reservation.roomId);
    let restored = false;
    if (originalRoom) {
      try {
        const restoredSeq = await saveReserveChecked(session, originalRoom, {
          date: original.date,
          startTime: original.time,
          endTime: originalEnd.time,
          title: reservation.title,
          contents: reservation.contents ?? "",
        });
        await markReservationModified(reservation.id, { cjSeq: restoredSeq });
        restored = true;
      } catch {
        restored = false;
      }
    }
    throw new ReservationModifyFailedError(
      restored
        ? "예약 변경 실패, 원래 예약은 유지되었습니다."
        : "예약 변경 실패, 원래 예약 복구도 실패했습니다. 직접 확인이 필요합니다.",
      restored
    );
  }

  try {
    await markReservationModified(reservation.id, {
      roomId: newRoom.id,
      startAt: toKstTimestamp(newDate, newStartTime),
      endAt: toKstTimestamp(newDate, newEndTime),
      cjSeq: newCjSeq,
    });
  } catch (err) {
    if (err instanceof RoomAlreadyBookedError) {
      await delReserve(session, newCjSeq).catch(() => {});
      throw err;
    }
    throw err;
  }

  return {
    reservationId: reservation.id,
    roomName: newRoom.roomName,
    date: newDate,
    startTime: newStartTime,
    endTime: newEndTime,
    cjSeq: newCjSeq,
  };
}
