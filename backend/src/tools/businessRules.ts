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

/** 앱 로그인 비밀번호 연속 실패 허용 횟수. 도달하면 계정이 잠기고 Admin이 해제해야 한다
 * (20260820 마이그레이션 — 사내망 전용 방어막이 사라지는 외부 노출에 대비한 브루트포스 방어). */
export const MAX_LOGIN_ATTEMPTS = 5;

/** 1차 범위 사업장 — 상암S시티 고정 (도메인 정의서 6번). */
export const FIXED_SITE = "상암S시티";

/** 1차 범위 지원 층 (도메인 정의서 9번 "[결정됨]" — B1F/2F는 후보 풀에서 제외). */
export const SUPPORTED_FLOOR_LABELS = ["3F", "12F", "13F", "14F", "15F", "16F"] as const;

/** 선호 회의실 최대 등록 개수. 회원가입 폼(frontend/src/pages/register/PreferredRoomPicker.tsx의
 * MAX_PRIORITY_COUNT)과 반드시 같은 값을 유지해야 한다 — 값을 바꾸면 두 곳을 함께 고칠 것.
 * [2026-08-17 발견] 이 상한이 회원가입 폼에서만 클라이언트단으로 걸려 있고 챗봇의
 * add_preferred_room 도구에는 전혀 강제되지 않아, 채팅으로는 무제한 추가가 가능했다
 * (preferredRooms.tool.ts에서 이 상수로 검증). */
export const MAX_PREFERRED_ROOMS = 5;

/** 사용자가 회의명을 끝내 알려주지 않았을 때 쓰는 기본 제목 (사용자 결정, 20260816).
 * CJ 예약 현황은 다른 직원에게도 보이므로 아무 값이나 넣으면 안 되고, 의미가 있는 하나의
 * 값으로 고정한다. */
export const DEFAULT_RESERVATION_TITLE = "데이터 수집/분석 회의";

/** LLM이 회의명을 못 받았을 때 임의로 채워 넣던 무의미한 placeholder들 (실사용에서 관찰됨).
 * 이런 값이 오면 사용자가 실제로 준 제목이 아니므로 기본 제목으로 교체한다. */
const PLACEHOLDER_TITLES = ["회의", "미팅", "meeting", "회의실", "예약", "테스트", "test"];

/**
 * 저장 직전 회의명을 정규화한다. 비어있거나 LLM이 지어낸 placeholder면 기본 제목으로 바꾼다.
 *
 * [배경 — 20260816 실사용] 프롬프트로 "title은 사용자에게 물어서 받은 값만 쓰고 '회의' 같은
 * placeholder를 채워 넣지 말 것"이라고 지시했지만, 목록에서 회의실을 고르면 서버가 즉시
 * 실행하는 경로(3-5b)에서 모델이 회의명을 묻지 않고 그냥 "회의"로 저장해버린 사례가 나왔다.
 * 프롬프트 지시만으로는 막히지 않으므로 서버에서 결정론적으로 교정한다.
 */
export function normalizeReservationTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim();
  if (trimmed === "") return DEFAULT_RESERVATION_TITLE;
  return PLACEHOLDER_TITLES.includes(trimmed.toLowerCase()) ? DEFAULT_RESERVATION_TITLE : trimmed;
}

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
