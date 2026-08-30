// [레이어 2] 도구 계층 -- 내 예약 조회.
// 도메인 정의서 2번 "내 예약 조회": bindMyReservation(CJ)으로 해당 기간의 예약을 조회하고,
// 같은 reservation_request_id를 공유하는 예약(긴 회의 분할 케이스)은 하나로 묶어서 안내한다.
//
// [2026-08-31 수정 -- 실사용에서 발견] 이 챗봇을 거치지 않고(CJ WORLD 웹사이트에서 직접
// 등) 잡은 예약은 우리 DB에 없어서, DB만 보던 이전 버전은 그런 예약을 "없다"고 잘못
// 안내했다(실사용 재현 확인). 이제 bindMyReservation의 실제 응답(스키마 실측 완료,
// cj-automation/client.ts 참고)을 사용해서, 우리 DB에 없는 CJ 예약도 함께 보여준다.
//
// [분할 그룹 판정 근거] reservation_request_id(긴 회의를 여러 회의실로 나눈 그룹)는
// CJ 응답에 없는 정보라서, 그 판정은 여전히 우리 DB 기록에만 의존한다 -- 그래서 우리
// DB에 있는 예약(cj_seq로 매칭됨)은 DB 쪽 정보(그룹핑 포함)를 그대로 쓰고, CJ에만
// 있는 예약(cj_seq가 우리 DB에 없음)만 CJ 응답으로 새로 구성한다. 두 소스가 같은
// 예약을 중복으로 보여주지 않도록 cj_seq로 항상 교차 대조한다.

import { bindMyReservation } from "../cj-automation/client";
import { getValidSession } from "../cj-automation/session";
import { findActiveReservationsWithRoomByUserAndRange } from "../db/repositories/reservationRepository";
import { resolveEmailAlias } from "./availability.tool";
import { kstDayRange, toKstTimestamp } from "../lib/kst";

export interface MyReservationsQuery {
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
}

export interface MyReservationGroup {
  reservationRequestId: string | null;
  title: string;
  /** 이 챗봇으로 만든 예약("app")인지, 챗봇 밖(CJ WORLD 웹사이트 등)에서 잡혀 우리
   * DB엔 없는 예약("cj")인지 구분한다. "cj"는 이 앱으로 취소/변경할 수 없다 --
   * reservationId가 없어서(우리 DB 행이 없음) 취소 도구가 대상을 특정할 수 없다. */
  source: "app" | "cj";
  /** 분할 예약(긴 회의)이면 2건 이상, 아니면 1건. source="cj"는 항상 1건이다(분할
   * 그룹 정보는 우리 DB에만 있어서 CJ 응답만으로는 판정할 수 없다). */
  segments: Array<{
    /** source="cj"면 우리 DB 행이 없으므로 null. */
    reservationId: string | null;
    roomName: string | null;
    startAt: string;
    endAt: string;
    cjSeq: string | null;
  }>;
  /** 분할 예약 여부 -- true면 안내 문구에 "N개 회의실로 분할" 같은 문구를 붙여야 한다. */
  isSplit: boolean;
}

/**
 * 내 예약 조회 (도메인 정의서 2번). 우리 DB(reservations)에 있는 예약은 그대로 쓰고
 * (분할 그룹 정보까지 포함), CJ의 bindMyReservation이 알려주는 예약 중 우리 DB에 없는
 * 것(cj_seq 기준)도 함께 합쳐서 반환한다 -- 파일 상단 주석 참고.
 */
export async function getMyReservations(
  userId: string,
  query: MyReservationsQuery
): Promise<MyReservationGroup[]> {
  const session = await getValidSession(userId);
  const emailAlias = await resolveEmailAlias(userId);

  const rangeStartAt = kstDayRange(query.fromDate).rangeStartAt;
  const rangeEndAt = kstDayRange(query.toDate).rangeEndAt;
  const reservations = await findActiveReservationsWithRoomByUserAndRange(userId, rangeStartAt, rangeEndAt);

  const groupsByRequestId = new Map<string, MyReservationGroup>();
  const ungrouped: MyReservationGroup[] = [];
  const knownCjSeqs = new Set<string>();

  for (const reservation of reservations) {
    if (reservation.cjSeq) {
      knownCjSeqs.add(reservation.cjSeq);
    }

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
          source: "app",
          segments: [segment],
          isSplit: false,
        });
      }
    } else {
      ungrouped.push({
        reservationRequestId: null,
        title: reservation.title,
        source: "app",
        segments: [segment],
        isSplit: false,
      });
    }
  }

  // CJ 시스템이 실제로 보여주는 예약 중, 우리 DB에 없는(=이 챗봇 밖에서 잡힌) 것만
  // 추가로 합친다. 이 호출이 실패해도(CJ 쪽 일시 오류 등) DB 기준 결과는 그대로 준다.
  const cjOnly: MyReservationGroup[] = [];
  try {
    const cjResponse = await bindMyReservation(session, {
      email_alias: emailAlias,
      sdate: query.fromDate,
      edate: query.toDate,
    });
    for (const row of cjResponse.Table ?? []) {
      if (row.DEL_YN !== "0") continue; // 방어적 필터 -- 실측으로는 항상 "0"이었음
      if (knownCjSeqs.has(row.SEQ)) continue; // 이미 우리 DB에 있는 예약(중복 방지)

      cjOnly.push({
        reservationRequestId: null,
        title: row.CONF_TITE,
        source: "cj",
        isSplit: false,
        segments: [
          {
            reservationId: null,
            roomName: row.ROOM_NAME,
            // END_DATETIME이 아니라 END_TIME을 써야 한다(client.ts 주석 참고 -- END_DATETIME은
            // 항상 30분 더 크게 와서 실제 종료 시각이 아니다).
            startAt: toKstTimestamp(row.START_DATE, row.START_TIME),
            endAt: toKstTimestamp(row.START_DATE, row.END_TIME),
            cjSeq: row.SEQ,
          },
        ],
      });
    }
  } catch (err) {
    console.error("[tools/myReservations] bindMyReservation 호출 실패 (DB 기준 결과만 반환)", err);
  }

  return [...groupsByRequestId.values(), ...ungrouped, ...cjOnly].sort((a, b) =>
    a.segments[0].startAt.localeCompare(b.segments[0].startAt)
  );
}
