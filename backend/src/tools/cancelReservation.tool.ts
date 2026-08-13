// [레이어 2] 도구 계층 -- 예약 취소.
// 도메인 정의서 2번 "예약 취소": 대상이 여러 건이면 되묻고, 분할 예약(긴 회의) 건이면
// "전체 취소"인지 "그중 한 회의실만 취소"인지 기본값 없이 반드시 확인받는다.

import { delReserve } from "../cj-automation/client";
import { getValidSession } from "../cj-automation/session";
import {
  cancelReservationById,
  findReservationById,
  findReservationsByRequestId,
  type Reservation,
} from "../db/repositories/reservationRepository";
import { ReservationNotFoundError } from "./reservationTargeting";

export { findReservationCandidates as findCancellableReservationCandidates } from "./reservationTargeting";

/** 분할 예약(긴 회의) 그룹인데 "전체 취소"/"일부만 취소"를 아직 명시하지 않았을 때 던진다.
 * 기본값을 임의로 정하지 않는다는 도메인 정의서 2번 원칙을 코드로 강제한 것이다. */
export class SplitGroupCancelScopeRequiredError extends Error {
  constructor(
    message: string,
    public readonly groupSegments: Reservation[]
  ) {
    super(message);
    this.name = "SplitGroupCancelScopeRequiredError";
  }
}

export class ReservationAlreadyCancelledError extends Error {
  constructor(message = "이미 취소된 예약입니다.") {
    super(message);
    this.name = "ReservationAlreadyCancelledError";
  }
}

export interface CancelReservationParams {
  reservationId: string;
  /** 분할 예약(같은 reservation_request_id)의 일부라면 반드시 명시해야 한다.
   * 단일 예약이면 무시된다. */
  scope?: "single" | "entire_group";
}

export interface CancelledReservationSummary {
  reservationId: string;
  roomId: string;
  startAt: string;
  endAt: string;
}

/**
 * 예약을 취소한다. reservationId는 이미 사용자와 확인을 마친(모호하지 않게 특정된)
 * 대상이어야 한다 -- 여러 후보 중 특정하는 단계는 reservationTargeting.ts가 담당한다.
 *
 * 분할 예약(긴 회의) 그룹의 일부이고 아직 남아있는 세그먼트가 2건 이상이면, scope를
 * 명시하지 않은 호출은 SplitGroupCancelScopeRequiredError로 거부한다 -- 오케스트레이션
 * 계층이 이 에러를 잡아 사용자에게 "전체 취소할까요, 이 회의실만 취소할까요?"로 되묻고,
 * 답을 받은 뒤 scope를 채워 다시 호출해야 한다.
 */
export async function cancelReservation(
  userId: string,
  params: CancelReservationParams
): Promise<CancelledReservationSummary[]> {
  const reservation = await findReservationById(params.reservationId);
  if (!reservation || reservation.userId !== userId) {
    throw new ReservationNotFoundError();
  }
  if (reservation.status === "cancelled") {
    throw new ReservationAlreadyCancelledError();
  }

  let targets: Reservation[] = [reservation];

  if (reservation.reservationRequestId) {
    const group = await findReservationsByRequestId(reservation.reservationRequestId);
    const activeGroup = group.filter((entry) => entry.status !== "cancelled");

    if (activeGroup.length > 1) {
      if (!params.scope) {
        throw new SplitGroupCancelScopeRequiredError(
          `이 예약은 ${activeGroup.length}개 회의실로 분할된 연속 회의의 일부입니다. 전체를 취소할지, 이 회의실만 취소할지 확인이 필요합니다.`,
          activeGroup
        );
      }
      if (params.scope === "entire_group") {
        targets = activeGroup;
      }
      // scope === "single"이면 targets는 이미 [reservation]으로 설정되어 있다.
    }
  }

  const session = await getValidSession(userId);
  const results: CancelledReservationSummary[] = [];

  for (const target of targets) {
    if (target.cjSeq) {
      await delReserve(session, target.cjSeq);
    }
    await cancelReservationById(target.id);
    results.push({
      reservationId: target.id,
      roomId: target.roomId,
      startAt: target.startAt,
      endAt: target.endAt,
    });
  }

  return results;
}
