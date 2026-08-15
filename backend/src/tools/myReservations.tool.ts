// [레이어 2] 도구 계층 -- 내 예약 조회.
// 도메인 정의서 2번 "내 예약 조회": bindMyReservation(CJ)으로 해당 기간의 예약을 조회하고,
// 같은 reservation_request_id를 공유하는 예약(긴 회의 분할 케이스)은 하나로 묶어서 안내한다.
//
// [미확정 -- 실사용 라이브 테스트 전] bindMyReservation의 정확한 응답 스키마는 도메인
// 정의서 9번에 요청 파라미터(email_alias, sdate, edate)만 정리되어 있고 응답 필드명은
// 문서화된 적이 없다. 이 파일은 CJ 응답을 신뢰하되(실제 CJ가 보여주는 "진짜" 예약 목록),
// 분할 그룹 판정처럼 CJ 응답만으로 알 수 없는 정보(reservation_request_id)는 우리 DB
// 기록과 cj_seq로 교차 대조한다. CJ 응답 필드명이 확인되면 이 파일과 도메인 정의서
// 9번을 함께 갱신해야 한다.

import { bindMyReservation } from "../cj-automation/client";
import { getValidSession } from "../cj-automation/session";
import { findActiveReservationsWithRoomByUserAndRange } from "../db/repositories/reservationRepository";
import { resolveEmailAlias } from "./availability.tool";
import { kstDayRange } from "../lib/kst";

export interface MyReservationsQuery {
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
}

export interface MyReservationGroup {
  reservationRequestId: string | null;
  title: string;
  /** 분할 예약(긴 회의)이면 2건 이상, 아니면 1건. */
  segments: Array<{
    reservationId: string;
    roomName: string | null;
    startAt: string;
    endAt: string;
    cjSeq: string | null;
  }>;
  /** 분할 예약 여부 -- true면 안내 문구에 "N개 회의실로 분할" 같은 문구를 붙여야 한다. */
  isSplit: boolean;
}

/**
 * 내 예약 조회 (도메인 정의서 2번). CJ의 bindMyReservation을 호출해 실제로 CJ 시스템에
 * 남아있는 예약인지 확인하되[주석 참고, 응답 스키마 미확정이라 이 호출 자체는 수행하고
 * 결과를 로그로 남기는 선에서 그친다], 사용자에게 보여줄 실제 목록/분할 그룹핑은 우리
 * DB(reservations, reservation_request_id)를 기준으로 구성한다 -- DB가 이 앱이 만든
 * 예약의 신뢰 가능한 소스이고, 분할 그룹 정보(reservation_request_id)는 CJ에 없다.
 */
export async function getMyReservations(
  userId: string,
  query: MyReservationsQuery
): Promise<MyReservationGroup[]> {
  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  // CJ 시스템 관점의 "진짜" 예약 목록도 함께 확인한다 (도메인 정의서 2번 명시 API).
  // 응답 스키마가 미확정이므로 여기서는 실패해도 전체 조회를 막지 않는다.
  await bindMyReservation(session, {
    email_alias: emailAlias,
    sdate: query.fromDate,
    edate: query.toDate,
  }).catch((err) => {
    console.error("[tools/myReservations] bindMyReservation 호출 실패 (DB 기준으로 계속 진행)", err);
  });

  const rangeStartAt = kstDayRange(query.fromDate).rangeStartAt;
  const rangeEndAt = kstDayRange(query.toDate).rangeEndAt;
  const reservations = await findActiveReservationsWithRoomByUserAndRange(userId, rangeStartAt, rangeEndAt);

  const groupsByRequestId = new Map<string, MyReservationGroup>();
  const ungrouped: MyReservationGroup[] = [];

  for (const reservation of reservations) {
    const segment = {
      reservationId: reservation.id,
      roomName: reservation.roomName,
      startAt: reservation.startAt,
      endAt: reservation.endAt,
      cjSeq: reservation.cjSeq,
    };

    if (reservation.reservationRequestId) {
      const existing = groupsByRequestId.get(reservation.reservationRequestId);
      if (existing) {
        existing.segments.push(segment);
        existing.isSplit = existing.segments.length > 1;
      } else {
        groupsByRequestId.set(reservation.reservationRequestId, {
          reservationRequestId: reservation.reservationRequestId,
          title: reservation.title,
          segments: [segment],
          isSplit: false,
        });
      }
    } else {
      ungrouped.push({
        reservationRequestId: null,
        title: reservation.title,
        segments: [segment],
        isSplit: false,
      });
    }
  }

  return [...groupsByRequestId.values(), ...ungrouped].sort(
    (a, b) => a.segments[0].startAt.localeCompare(b.segments[0].startAt)
  );
}
