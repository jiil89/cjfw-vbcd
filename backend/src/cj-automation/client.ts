// CJ 자동화 계층 — 도메인 정의서 9번에 정리된 ASMX 엔드포인트 래퍼.
//
// 이 파일은 세션(CjSession)과 파라미터만 받아 CJ 사내 예약 시스템의 API를 호출하고
// 응답을 파싱해서 돌려준다. 예약 비즈니스 규칙(2시간 제한, 선호 회의실 우선순위 등)은
// 전혀 모른다 — 그건 상위 도구(tools) 계층의 책임이다 (5-project-principle.md §2).
//
// 원본 CJ API 필드명(area_code, room_code, seq 등)은 이 파일 내부(요청 바디 조립)에서만
// 그대로 쓰고, 함수 시그니처(파라미터/리턴)는 우리 도메인 이름(camelCase)을 쓴다
// (5-project-principle.md §3) — 특히 area_code가 "건물"과 "층" 두 의미로 혼용되는
// 혼란(도메인 정의서 9번 "주의할 점")이 상위 계층까지 전파되지 않도록, 검증 API
// 파라미터는 areaCode 대신 floorCode로 이름을 명확히 한다.
//
// [2026-08-13 실사용 재검증] 모든 ASMX 엔드포인트는 baseUrl 바로 아래가 아니라
// `NCONF/Common/WebService/` 경로 아래에 있다(예: 실제 URL은
// `https://cjwappr.cj.net/NCONF/Common/WebService/WSConferenceReserve.asmx/getDayPilotConfReserveList`).
// 이 접두사 없이 호출하면 500(런타임 오류 HTML)이 반환된다 — 이전 버전은 이 접두사가
// 빠져 있었다. IIS 라우팅은 대소문자를 구분하지 않음을 확인했으므로(실측: 일부 엔드포인트는
// 실제 페이지가 `Webservice`로 쓰지만 `WebService`로 호출해도 정상 동작), 이 파일에서는
// 표기를 `WebService`로 통일한다.
//
// [2026-08-13 실사용 재검증] 응답 본문은 실제로 항상 UTF-8이다. 이전 버전은 브라우저
// 관찰 시 Content-Type에 charset이 없는 경우를 "UTF-8이 아니다"로 오판하고 EUC-KR로
// 디코딩했는데, 이는 틀린 결론이었다 — 실제로는 raw bytes를 그냥 UTF-8로 디코딩하면
// 한글이 정상적으로 나온다(예: "하위"). Content-Type 유무와 무관하게 항상 UTF-8로
// 디코딩한다. (도메인 정의서 9번도 이 내용으로 갱신 필요.)

import type { CjSession } from "./session";

// 모든 ASMX 웹서비스가 공통으로 위치한 경로 접두사 (실측 확인, 파일 상단 주석 참고).
const ASMX_BASE_PATH = "NCONF/Common/WebService";

export class CjApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly rawBody: string
  ) {
    super(message);
    this.name = "CjApiError";
  }
}

// [2026-08-14 실사용 검증 완료] SaveReserve가 실패(Result:0)할 때, `.d` 안의 JSON 텍스트에
// CJ 쪽 직렬화 버그로 보이는 결측 값이 섞여 나온다 — 예: `{"Result":0,"MailResult":0,"Seq":}`
// 처럼 값 없이 콜론 뒤에 바로 `}`/`,`가 오는 필드. 이런 "구멍"을 `null`로 메꿔서 최소한
// 파싱은 되게 한다(성공 시에는 Seq가 정상적으로 채워져 있어 이 문제가 없다).
function repairDanglingJsonValues(text: string): string {
  return text.replace(/:\s*([,}])/g, ": null$1");
}

function decodeCjResponseBody(buffer: Buffer): string {
  // 실사용 재검증 결과 응답은 항상 UTF-8이다 (파일 상단 주석 참고). Content-Type 헤더에
  // charset이 없는 경우가 있어 헤더를 신뢰하지 않고 항상 UTF-8로 디코딩한다.
  return buffer.toString("utf8");
}

// [2026-08-13 실사용 재검증 — 방어 로직] 로그인 직후(회의실 페이지 로드 시 대시보드
// 위젯이 백그라운드로 동일 세션에 getDayPilotConfReserveList 등을 폴링하는 것으로
// 추정됨) 같은 세션으로 거의 동시에 같은 엔드포인트가 호출되면, 서버가 두 응답을
// 이어붙여 돌려주는 현상을 실측으로 재현했다(예: `...}{"d":null}`처럼 완전한 JSON
// 뒤에 바이트가 더 붙어서 옴). 원인은 CJ 서버 쪽 세션 동시성 처리로 추정되며 우리
// 쪽에서 고칠 수 없으므로, 첫 번째 완전한 JSON 값만 파싱하고 나머지는 버리는 방어
// 로직을 둔다.
function parseFirstJsonValue(text: string): unknown {
  const trimmed = text.trimStart();
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let started = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      started = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      started = true;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (started && depth === 0) {
        return JSON.parse(trimmed.slice(0, i + 1));
      }
    }
  }

  // 끝까지 스캔해도 완결된 JSON 값을 못 찾았으면 원래 문자열로 파싱을 시도해 원래
  // 오류(JSON.parse 실패)가 그대로 나게 둔다.
  return JSON.parse(trimmed);
}

async function callCjApi<T = unknown>(
  session: CjSession,
  endpointPath: string,
  params: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${session.baseUrl}/${ASMX_BASE_PATH}/${endpointPath}`, {
    method: "POST",
    headers: {
      Cookie: session.cookieHeader,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(params),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const rawText = decodeCjResponseBody(buffer);

  if (!response.ok) {
    throw new CjApiError(
      `[cj-automation/client] ${endpointPath} 호출 실패 (status ${response.status})`,
      response.status,
      rawText
    );
  }

  const text = rawText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 완전한 JSON 뒤에 트레일링 바이트가 붙는 서버 쪽 현상에 대한 방어 (위 주석 참고)
    try {
      parsed = parseFirstJsonValue(text);
    } catch {
      throw new CjApiError(
        `[cj-automation/client] ${endpointPath} 응답을 JSON으로 파싱하지 못했습니다.`,
        response.status,
        rawText
      );
    }
  }

  if (parsed && typeof parsed === "object" && "d" in (parsed as Record<string, unknown>)) {
    const inner = (parsed as Record<string, unknown>).d;
    // [2026-08-14 실사용 검증] ASMX 메서드의 C# 반환 타입이 string인 경우(예: checkRoom,
    // SaveReserve) `.d`는 객체가 아니라 "JSON 텍스트를 담은 문자열"이라 한 번 더 파싱해야
    // 실제 필드(Result 등)에 접근할 수 있다(실제 웹 UI도 `$.parseJSON(data.d)`로 이렇게
    // 이중 파싱한다 — reserve_insmod.js). 반환 타입이 이미 객체인 엔드포인트(예:
    // getDayPilotConfReserveList)는 `.d`가 처음부터 객체라 이 분기를 타지 않는다.
    if (typeof inner === "string") {
      try {
        return JSON.parse(inner) as T;
      } catch {
        // [2026-08-14 실사용 검증] SaveReserve가 실패(Result:0)할 때 CJ 쪽 직렬화 버그로
        // 보이는 `"Seq":}`처럼 값 없는 필드가 섞여 나온다(JSON 모드/form 모드 둘 다 동일
        // 하게 재현됨). 값 없는 필드를 null로 메꿔서 최소한 Result/MailResult는 읽히게 한다.
        try {
          return JSON.parse(repairDanglingJsonValues(inner)) as T;
        } catch {
          return inner as T;
        }
      }
    }
    return inner as T;
  }
  return parsed as T;
}

// ── 0. 회의실/층 목록 조회 ───────────────────────────────────────────────
//
// 파라미터 없음(9번 명세). 회의실 마스터데이터 시딩(DB-5)처럼 area_code/sub_area_code/
// room_code를 처음 발견해야 하는 스크립트에서만 쓴다 — 일반 예약 흐름(BE-6)은 이미
// DB에 저장된 rooms 테이블을 참조하므로 이 API를 호출할 필요가 없다.
export async function listArea(session: CjSession): Promise<unknown> {
  return callCjApi(session, "WSConferenceMain.asmx/listArea", {});
}

// ── 1. 날짜별 예약 현황(가용성) 조회 ────────────────────────────────────────

export interface CjReserveGridResponse {
  reserve_all_list?: unknown;
  event_list?: unknown;
  room_info?: unknown;
  [key: string]: unknown;
}

export interface GetDayPilotConfReserveListParams {
  areaList: string;
  reserveDate: string;
  emailAlias: string;
}

export async function getDayPilotConfReserveList(
  session: CjSession,
  params: GetDayPilotConfReserveListParams
): Promise<CjReserveGridResponse> {
  return callCjApi<CjReserveGridResponse>(
    session,
    "WSConferenceReserve.asmx/getDayPilotConfReserveList",
    {
      areaList: params.areaList,
      reservedate: params.reserveDate,
      email_alias: params.emailAlias,
    }
  );
}

// ── 2. 빈 회의실 추천 ────────────────────────────────────────────────────

export interface GetEmptyRoomInfoParams {
  roomCode: string;
  startDate: string;
  startTime: string;
  endTime: string;
}

export async function getEmptyRoomInfo(
  session: CjSession,
  params: GetEmptyRoomInfoParams
): Promise<unknown> {
  return callCjApi(session, "WSConfReserveinsmod.asmx/getEmptyRoomInfo", {
    roomcode: params.roomCode,
    startdate: params.startDate,
    starttime: params.startTime,
    endtime: params.endTime,
  });
}

// ── 3. 예약 가능 여부 검증 1 ─────────────────────────────────────────────

export interface CheckRoomParams {
  /** 주의(9번): 이 API의 area_code는 "층 코드"를 가리킨다 (건물 코드 아님). */
  floorCode: string;
  roomCode: string;
  startDate: string;
  startTime: string;
  endTime: string;
  /** 변경 흐름에서 자기 자신을 검증 대상에서 제외할 때 쓰는 것으로 추정 (8번 Open Question, 미확정) */
  seq?: string;
}

export async function checkRoom(session: CjSession, params: CheckRoomParams): Promise<unknown> {
  return callCjApi(session, "WSConfReserveinsmod.asmx/checkRoom", {
    area_code: params.floorCode,
    room_code: params.roomCode,
    start_date: params.startDate,
    start_time: params.startTime,
    end_time: params.endTime,
    seq: params.seq ?? "",
  });
}

// ── 4. 예약 가능 여부 검증 2 (동일 사용자+회의실 하루 누적 2시간 체크) ──────

export interface CheckStraightRoomParams {
  floorCode: string;
  roomCode: string;
  startDate: string;
  startTime: string;
  endTime: string;
  emailAlias: string;
  seq?: string;
}

export async function checkStraightRoom(
  session: CjSession,
  params: CheckStraightRoomParams
): Promise<unknown> {
  return callCjApi(session, "WSConfReserveinsmod.asmx/checkStraightRoom", {
    area_code: params.floorCode,
    room_code: params.roomCode,
    start_date: params.startDate,
    start_time: params.startTime,
    end_time: params.endTime,
    email_alias: params.emailAlias,
    seq: params.seq ?? "",
  });
}

// ── 5. 일일 예약 건수 제한 검증 ──────────────────────────────────────────

export interface CheckDayCountLimitParams {
  roomCode: string;
  startDate: string;
  emailAlias: string;
  seq?: string;
}

export async function checkDayCountLimit(
  session: CjSession,
  params: CheckDayCountLimitParams
): Promise<unknown> {
  return callCjApi(session, "WSConfReserveinsmod.asmx/checkDayCountLimit", {
    room_code: params.roomCode,
    start_date: params.startDate,
    email_alias: params.emailAlias,
    seq: params.seq ?? "",
  });
}

// ── 6. 예약 생성/수정 ────────────────────────────────────────────────────

export interface SaveReserveParams {
  /** 건물 코드 (checkRoom 등 검증 API의 area_code=층 코드와 다르다 — 9번 "주의할 점") */
  buildingCode: string;
  /** 층 코드 */
  floorCode: string;
  roomCode: string;
  roomName: string;
  reserveDate: string;
  startTime: string;
  endTime: string;
  title: string;
  contents: string;
  phoneNum: string;
  /** [2026-08-14 실사용 검증 완료] CJ 실제 웹 UI가 브라우저에서 보내는 요청을 Playwright로
   * 직접 재현/캡처해서(`/NCONF/ConferenceRoom/script/reserve_insmod.js`의 `$('#btnConfirm')`
   * click 핸들러 원본을 확보함) 아래 필드들과 정확한 타입/기본값을 확정했다. 이전 버전의
   * 필드 추측(예: attendeeCount=회의실 정원, isSendMail=boolean)은 전부 틀렸었다 — CJ가
   * "매개 변수가 없습니다"로 필드 누락은 알려줬지만 타입/의미는 알려주지 않았기 때문.
   * "1" = 메일 발송함, "0" = 안 함(체크박스 기본 미체크 상태와 동일). */
  isSendMail: "0" | "1";
  /** 참석 인원수 필드지만, 실제 UI는 참석자 목록(reqList) 인원수와 무관하게 **항상 빈
   * 문자열**을 보낸다(reserve_insmod.js: `"attendee_count": ''`) — UI 자체가 이 필드를
   * 사실상 안 쓰는 것으로 보임. */
  attendeeCount: "";
  /** "승인 필요 여부"(도메인 정의서 9번이 읽기 경로에서 관찰한 GUBUN과는 별개 의미).
   * 회의실 마스터데이터의 `REQUIRED_APPROVAL` 값을 그대로 전달하는 필드 — 0=승인 불필요,
   * 1=승인 필요. 이 프로젝트가 다루는 일반 회의실은 전부 승인 불필요이므로 0 고정. */
  gubun: 0 | 1;
  /** 참석자(TO) 목록 — 사내 계정 alias를 쉼표로 이어붙인 문자열. 참석자 없으면 빈 문자열. */
  reqList: string;
  /** 참조자(CC) 목록 — reqList와 동일 형식. */
  optList: string;
  /** 사전알림 제공 회의실 여부. "True"/"False" 문자열(boolean 아님) — 회의실 마스터데이터의
   * `PRE_MAIL_ALARM_YN` 값을 그대로 전달한다. */
  isSendAlarm: "True" | "False";
  /** 승인 필요 회의실(gubun=1)일 때만 값이 채워지는 승인자 alias 목록. gubun=0이면 빈 문자열. */
  adminAlias: string;
  /** adminAlias와 짝을 이루는 승인자 언어 목록. gubun=0이면 빈 문자열. */
  adminLang: string;
  /** "I" = 생성, "U"는 실제로는 별도 엔드포인트(`modReserve`)를 쓴다(9번 Open Question 갱신 필요). */
  reserveType: string;
}

export async function saveReserve(
  session: CjSession,
  params: SaveReserveParams
): Promise<unknown> {
  return callCjApi(session, "WSConfReserveinsmod.asmx/SaveReserve", {
    seq: "",
    area_code: params.buildingCode,
    subarea_code: params.floorCode,
    room_code: params.roomCode,
    room_name: params.roomName,
    reserve_date: params.reserveDate,
    start_time: params.startTime,
    end_time: params.endTime,
    title: params.title,
    contents: params.contents,
    attendee_count: params.attendeeCount,
    phone_num: params.phoneNum,
    gubun: params.gubun,
    req_list: params.reqList,
    opt_list: params.optList,
    is_send_mail: params.isSendMail,
    is_send_alarm: params.isSendAlarm,
    admin_alias: params.adminAlias,
    admin_lang: params.adminLang,
    reservetype: params.reserveType,
  });
}

// ── 7. 예약 취소 ─────────────────────────────────────────────────────────

export async function delReserve(session: CjSession, cjSeq: string): Promise<unknown> {
  return callCjApi(session, "WSINConference.asmx/delReserve", { seq: cjSeq });
}

// ── 8. 예약 상세 조회 ────────────────────────────────────────────────────

export async function getConfReservationInfo(
  session: CjSession,
  cjSeq: string
): Promise<unknown> {
  return callCjApi(session, "WSConferenceReserve.asmx/getConfReservationInfo", { seq: cjSeq });
}

// ── 9. 내 예약 목록 조회 ─────────────────────────────────────────────────
//
// 9번 명세에 정확한 파라미터 이름이 나와있지 않다 ("날짜 범위 등"으로만 서술됨).
// 명세에 없는 파라미터 이름을 추측해서 만들지 않기 위해(작업 지침), 호출자가
// 원본 CJ 파라미터를 그대로 넘기도록 Record<string, unknown>을 받는다. 정확한
// 파라미터 이름은 실사용 확인 후 도메인 정의서 9번에 반영하고 이 시그니처도
// 구체화해야 한다.
export async function bindMyReservation(
  session: CjSession,
  rawParams: Record<string, unknown>
): Promise<unknown> {
  return callCjApi(session, "m_WSConfReservelist.asmx/bindMyReservation", rawParams);
}
