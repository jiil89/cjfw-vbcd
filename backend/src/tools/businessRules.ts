// 도구(tools) 계층 공통 비즈니스 규칙 상수/검증 헬퍼.
// 도메인 정의서 6번 "비즈니스 규칙/제약조건"에 확정된 값만 담는다. 규칙이 바뀌면
// 도메인 정의서를 먼저 고치고 이 파일을 따라 고친다 (5-project-principle.md §1).
//
// 이 파일은 순수 함수만 담고 CJ 자동화/DB를 전혀 모른다 — 유닛 테스트로만 검증한다
// (5-project-principle.md §4).

/** 예약 가능 시간(도메인 정의서 6번 "[확인됨]"). */
export const OPERATING_HOURS = { startTime: "07:00", endTime: "19:00" } as const;

/** 예약 단위(분) — 30분 (도메인 정의서 6번). */
export const RESERVATION_UNIT_MINUTES = 30;

/** 1회(=한 회의실 한 세그먼트) 최대 예약 시간(분) — 2시간 (도메인 정의서 6번). */
export const MAX_SINGLE_ROOM_MINUTES = 120;

/** 예약 가능 범위 — 오늘부터 7일 뒤까지 (도메인 정의서 6번). */
export const MAX_ADVANCE_DAYS = 7;

/** 1차 범위 사업장 — 상암S시티 고정 (도메인 정의서 6번). */
export const FIXED_SITE = "상암S시티";

/** 1차 범위 지원 층 (도메인 정의서 9번 "[결정됨]" — B1F/2F는 후보 풀에서 제외). */
export const SUPPORTED_FLOOR_LABELS = ["3F", "12F", "13F", "14F", "15F", "16F"] as const;

function timeToMinutes(hhmm: string): number {
  const [hourStr, minuteStr] = hhmm.split(":");
  return Number(hourStr) * 60 + Number(minuteStr);
}

/** "HH:mm" 형식이고 RESERVATION_UNIT_MINUTES(30분) 단위에 정렬되어 있는지 확인한다. */
export function isAlignedToReservationUnit(hhmm: string): boolean {
  return timeToMinutes(hhmm) % RESERVATION_UNIT_MINUTES === 0;
}

/** 요청 시간대가 운영시간(07:00~19:00) 안에 완전히 들어오는지 확인한다. */
export function isWithinOperatingHours(startTime: string, endTime: string): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return (
    start >= timeToMinutes(OPERATING_HOURS.startTime) &&
    end <= timeToMinutes(OPERATING_HOURS.endTime) &&
    end > start
  );
}

/** 종료-시작 시간 차이(분)를 계산한다. */
export function durationMinutes(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

/**
 * 요청 날짜가 "오늘부터 7일 뒤까지" 범위 안인지 확인한다 (도메인 정의서 6번).
 * today/requestDate는 "YYYY-MM-DD" 문자열, 타임존 없이 달력일 기준으로 비교한다.
 */
export function isWithinBookableDateRange(requestDate: string, today: string): boolean {
  const requestMs = Date.parse(`${requestDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(requestMs) || Number.isNaN(todayMs)) {
    return false;
  }
  const diffDays = Math.round((requestMs - todayMs) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= MAX_ADVANCE_DAYS;
}

export class BusinessRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleViolationError";
  }
}

/**
 * 예약 요청(단일 세그먼트가 아니라 사용자가 원한 "전체" 시간대) 하나에 대해 운영시간/
 * 정렬/날짜범위를 검증한다. 2시간 제한은 여기서 막지 않는다 — 2시간 초과는 "거부"가
 * 아니라 "분할 예약 대상"이기 때문이다 (도메인 정의서 2번 "긴 회의 요청").
 */
export function assertValidReservationWindow(params: {
  date: string;
  today: string;
  startTime: string;
  endTime: string;
}): void {
  if (!isWithinBookableDateRange(params.date, params.today)) {
    throw new BusinessRuleViolationError(
      `예약 가능한 날짜 범위(오늘~${MAX_ADVANCE_DAYS}일 뒤)를 벗어났습니다: ${params.date}`
    );
  }
  if (!isAlignedToReservationUnit(params.startTime) || !isAlignedToReservationUnit(params.endTime)) {
    throw new BusinessRuleViolationError(
      `예약 시간은 ${RESERVATION_UNIT_MINUTES}분 단위여야 합니다: ${params.startTime}~${params.endTime}`
    );
  }
  if (!isWithinOperatingHours(params.startTime, params.endTime)) {
    throw new BusinessRuleViolationError(
      `예약 가능 시간(${OPERATING_HOURS.startTime}~${OPERATING_HOURS.endTime})을 벗어났습니다: ${params.startTime}~${params.endTime}`
    );
  }
}
