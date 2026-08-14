// [레이어 2] 도구 계층 -- 예약 변경/취소 공용: "대상 예약 특정" 로직.
// 도메인 정의서 2번 "예약 변경"/"예약 취소": 되돌리기 어려운 액션이므로 대상이 조금이라도
// 모호하면(후보가 여러 건) 바로 진행하지 않고 반드시 먼저 확인받는다. 이 파일은 그
// "확인이 필요한 상태"를 명시적인 에러 타입으로 표현해서, 오케스트레이션(LLM) 계층이
// 이 에러를 잡아 사용자에게 되물을 수 있게 한다 (BE-6 완료조건).

import {
  findActiveReservationsWithRoomByUserAndRange,
  type ReservationWithRoom,
} from "../db/repositories/reservationRepository";
import { kstDayRange, toKstHHmm } from "../lib/kst";

export class ReservationNotFoundError extends Error {
  constructor(message = "해당 조건에 맞는 예약을 찾지 못했습니다.") {
    super(message);
    this.name = "ReservationNotFoundError";
  }
}

/** 후보가 2건 이상이라 하나로 특정할 수 없을 때 던진다. candidates를 그대로 담아
 * 오케스트레이션 계층이 "어떤 예약을 변경/취소할까요?" 선택지로 그대로 보여줄 수 있다. */
export class AmbiguousReservationTargetError extends Error {
  constructor(
    message: string,
    public readonly candidates: ReservationWithRoom[]
  ) {
    super(message);
    this.name = "AmbiguousReservationTargetError";
  }
}

export interface ReservationTargetHint {
  date: string; // "YYYY-MM-DD" -- 최소한 날짜는 있어야 검색 범위를 좁힐 수 있다.
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"
  roomName?: string;
}

function hintMatches(reservation: ReservationWithRoom, hint: ReservationTargetHint): boolean {
  if (hint.roomName && reservation.roomName !== hint.roomName) {
    return false;
  }
  if (hint.startTime) {
    if (toKstHHmm(reservation.startAt) !== hint.startTime) {
      return false;
    }
  }
  if (hint.endTime) {
    if (toKstHHmm(reservation.endAt) !== hint.endTime) {
      return false;
    }
  }
  return true;
}

/** hint로 좁힌 후보 목록을 반환한다 (0건/1건/여러 건 모두 그대로 반환 -- 판단은 호출자). */
export async function findReservationCandidates(
  userId: string,
  hint: ReservationTargetHint
): Promise<ReservationWithRoom[]> {
  const { rangeStartAt, rangeEndAt } = kstDayRange(hint.date);
  const dayReservations = await findActiveReservationsWithRoomByUserAndRange(
    userId,
    rangeStartAt,
    rangeEndAt
  );
  return dayReservations.filter((reservation) => hintMatches(reservation, hint));
}

/**
 * 후보를 정확히 1건으로 특정한다. 0건이면 ReservationNotFoundError, 2건 이상이면
 * AmbiguousReservationTargetError를 던진다 -- 두 경우 모두 도구 계층이 예약을 임의로
 * 변경/취소하지 않고 호출자(오케스트레이션)가 사용자에게 안내/재질문하도록 강제한다.
 */
export async function resolveSingleReservationTarget(
  userId: string,
  hint: ReservationTargetHint
): Promise<ReservationWithRoom> {
  const candidates = await findReservationCandidates(userId, hint);

  if (candidates.length === 0) {
    throw new ReservationNotFoundError();
  }
  if (candidates.length > 1) {
    throw new AmbiguousReservationTargetError(
      `조건에 맞는 예약이 ${candidates.length}건입니다. 어떤 예약을 말씀하시는지 확인이 필요합니다.`,
      candidates
    );
  }
  return candidates[0];
}
