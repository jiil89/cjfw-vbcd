// 한국 시각(KST, UTC+9) 변환 유틸 — 이 프로젝트는 상암S시티(한국) 하나만 지원하므로
// 타임존을 고정 상수로 둔다(6번 "1차 범위는 상암S시티 고정").
//
// [2026-08-14 실사용 검증에서 발견] reservation.tool.ts 등이 `${date}T${hhmm}:00`처럼
// 오프셋 없는 타임스탬프 문자열을 그대로 DB(timestamptz 컬럼)에 넘기고 있었다. 오프셋이
// 없는 문자열을 Postgres가 어떤 시각으로 해석할지는 **연결 세션의 TimeZone 설정에 따라
// 달라진다** — 로컬 개발 DB가 우연히 Asia/Seoul로 맞춰져 있어서 지금까지는 "09:00 KST로
// 요청 → 09:00 KST로 저장"이 우연히 맞아떨어졌지만, 세션 타임존이 다른 환경(예: 기본값이
// UTC인 Supabase)에 배포하면 같은 코드가 조용히 9시간 어긋난 시각으로 예약을 저장하는
// 심각한 버그가 된다. 오프셋을 항상 명시해서 이 환경 의존성을 없앤다.
//
// 읽는 쪽도 마찬가지로 문제였다: DB에서 돌아오는 timestamptz 값은 항상 UTC 인스턴트라
// `.toISOString()`/`.slice(11,16)`으로 그냥 잘라내면 "09:00 KST"가 "00:00"으로 보인다
// (reservationTargeting.ts의 hintMatches가 사용자가 말한 "09:00"과 저장된 값을 비교할 때
// 이 버그로 항상 매칭에 실패했을 수 있다). 항상 Asia/Seoul 기준으로 명시적으로 변환한다.

export const KST_UTC_OFFSET = "+09:00";

/** "YYYY-MM-DD" + "HH:mm" -> Postgres에 저장할, 오프셋이 명시된 타임스탬프 문자열. */
export function toKstTimestamp(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00${KST_UTC_OFFSET}`;
}

/** 날짜 하루 전체를 포괄하는 [start, end] 범위 — DB 범위 조회(BETWEEN 등)에 사용. */
export function kstDayRange(date: string): { rangeStartAt: string; rangeEndAt: string } {
  return {
    rangeStartAt: `${date}T00:00:00${KST_UTC_OFFSET}`,
    rangeEndAt: `${date}T23:59:59${KST_UTC_OFFSET}`,
  };
}

/** DB에서 읽은 timestamptz 값(Date 객체 또는 ISO 문자열)을 한국 시각 "HH:mm"으로 변환한다. */
export function toKstHHmm(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** DB에서 읽은 timestamptz 값을 한국 시각 기준 "YYYY-MM-DD"로 변환한다. */
export function toKstDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}
