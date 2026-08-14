// [레이어 1] LLM 오케스트레이션 — OpenAI tool-calling 스키마 정의.
//
// 5-project-principle.md §2: LLM은 판단만 하고 실행은 서버 코드가 한다. 여기서 노출하는
// 스키마는 전부 tools/ 계층(BE-6)의 함수 시그니처와 1:1로 대응한다 — 새 비즈니스 로직을
// 추가하지 않는다.
//
// 설계 원칙(BE-7 완료조건 "SaveReserve 직전 명시적 확인 없이는 실행 불가"):
// 실제로 CJ 시스템에 쓰기를 발생시키는 동작(createReservation/createSplitReservation/
// modifyReservation/cancelReservation)은 "propose_*"(제안, 부작용 없음)과 "confirm_*"
// (실행, confirmationToken 필수) 두 도구로 분리한다. LLM이 confirm_*을 호출해도, 서버
// (orchestrator.ts + sessionStore.ts)가 토큰이 "이전 턴에 등록된 pendingConfirmation"과
// 정확히 일치할 때만 실제로 tools/ 함수를 호출한다 — LLM이 스스로 "사용자가 동의했다"고
// 주장하는 것만으로는 절대 실행되지 않는다.

export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
}

// propose_create_reservation / propose_split_reservation / propose_modify_reservation이
// 공통으로 받는 "회의실" 파라미터. check_availability/plan_long_meeting/recommend_rooms
// 도구 결과에 그대로 포함된 room 객체를 그대로 복사해서 넘기도록 유도한다(새로 지어내지
//않게). id/roomCode/roomName/areaCode/subAreaCode는 CJ 예약 생성에 실제로 쓰이므로 필수.
const ROOM_SCHEMA = {
  type: "object",
  description: "직전 조회 도구(check_availability/plan_long_meeting/recommend_rooms) 결과에서 그대로 복사한 회의실 객체.",
  properties: {
    id: { type: "string", description: "회의실 DB id (uuid)" },
    roomCode: { type: "string" },
    roomName: { type: "string" },
    areaCode: { type: "string", description: "건물 코드" },
    subAreaCode: { type: "string", description: "층 코드" },
    floorLabel: { type: ["string", "null"] },
    capacity: { type: ["number", "null"] },
  },
  required: ["id", "roomCode", "roomName", "areaCode", "subAreaCode"],
  additionalProperties: false,
} as const;

const DATE_PROP = { type: "string", description: '"YYYY-MM-DD" 형식' } as const;
const TIME_PROP = { type: "string", description: '"HH:mm" 형식, 30분 단위' } as const;

export const toolSchemas: OpenAiToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "지정한 날짜/시간대(+선택적으로 최소 인원수, 특정 층)에 예약 가능한 회의실을 조회한다. 선호 회의실(preferred)과 그 외 가용 회의실(others)을 함께 반환한다. 부작용 없음(조회 전용).",
      parameters: {
        type: "object",
        properties: {
          date: DATE_PROP,
          startTime: TIME_PROP,
          endTime: TIME_PROP,
          minCapacity: { type: "integer", description: "조건 검색: 최소 수용 인원 (선택)" },
          floorLabel: { type: "string", description: '조건 검색: 특정 층으로 한정 (예: "12F"). 지원 층: 3F,12F~16F' },
        },
        required: ["date", "startTime", "endTime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_long_meeting",
      description:
        "요청 시간이 2시간(120분)을 초과하는 긴 회의를 위해, 여러 회의실로 나눈 분할 계획을 세운다(부작용 없음, 아직 예약을 만들지 않음). 120분 이하 요청에는 사용하지 않는다.",
      parameters: {
        type: "object",
        properties: {
          date: DATE_PROP,
          startTime: TIME_PROP,
          endTime: TIME_PROP,
          minCapacity: { type: "integer", description: "선택: 최소 수용 인원" },
        },
        required: ["date", "startTime", "endTime"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_rooms",
      description:
        '"자주 쓰던 회의실로 해줘" 같은 이력 기반 표현에 사용. 등록된 선호 회의실이 있으면 그걸 그대로, 없으면 과거 예약 횟수가 많은 회의실 순으로 추천한다. 부작용 없음.',
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "최대 추천 개수 (기본 3)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_reservations",
      description:
        "지정한 기간(fromDate~toDate)의 내 예약 목록을 조회한다. 분할 예약(긴 회의)은 여러 회의실이 하나의 그룹으로 묶여서 반환된다(isSplit=true). 부작용 없음.",
      parameters: {
        type: "object",
        properties: {
          fromDate: DATE_PROP,
          toDate: DATE_PROP,
        },
        required: ["fromDate", "toDate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_reservation_candidates",
      description:
        "예약 변경/취소 대상을 찾기 위해, 주어진 날짜(+선택적으로 시간/회의실명 힌트)에 해당하는 내 예약 후보를 조회한다. 결과가 0건이면 못 찾은 것, 2건 이상이면 반드시 사용자에게 되물어야 한다(임의로 하나를 고르지 말 것). 부작용 없음.",
      parameters: {
        type: "object",
        properties: {
          date: DATE_PROP,
          startTime: { ...TIME_PROP, description: "선택: 후보를 좁히기 위한 시작 시각 힌트" },
          endTime: { ...TIME_PROP, description: "선택: 후보를 좁히기 위한 종료 시각 힌트" },
          roomName: { type: "string", description: "선택: 후보를 좁히기 위한 회의실명 힌트" },
        },
        required: ["date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_create_reservation",
      description:
        "신규 단일 회의실 예약(최대 120분)을 제안한다. 아직 CJ 시스템에 저장하지 않는다 — confirmationToken을 반환하며, 이 내용을 사용자에게 보여주고 다음 메시지로 명시적 동의를 받은 뒤에만 confirm_create_reservation을 호출할 수 있다.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "회의명" },
          contents: { type: "string", description: "회의 내용/목적" },
          phoneNum: { type: "string", description: "연락처 (사용자가 알려주지 않았다면 빈 문자열)" },
          date: DATE_PROP,
          startTime: TIME_PROP,
          endTime: TIME_PROP,
          room: ROOM_SCHEMA,
        },
        required: ["title", "contents", "phoneNum", "date", "startTime", "endTime", "room"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_create_reservation",
      description:
        "직전에 propose_create_reservation으로 제안하고, 사용자가 그 다음 메시지에서 명시적으로 동의한 예약을 실제로 CJ 시스템에 확정 생성한다. 사용자의 명시적 동의 없이 호출하지 말 것.",
      parameters: {
        type: "object",
        properties: {
          confirmationToken: { type: "string", description: "propose_create_reservation 응답의 confirmationToken" },
        },
        required: ["confirmationToken"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_split_reservation",
      description:
        "plan_long_meeting으로 받은 분할 계획(plan)을 그대로 이용해 여러 회의실에 걸친 긴 회의 예약을 제안한다. 아직 CJ 시스템에 저장하지 않는다 — confirmationToken을 반환하며, 사용자의 다음 메시지 동의 후에만 confirm_split_reservation을 호출할 수 있다.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          contents: { type: "string" },
          phoneNum: { type: "string" },
          date: DATE_PROP,
          plan: {
            type: "array",
            description: "plan_long_meeting 응답의 segments를 그대로 전달 (2개 이상)",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                room: ROOM_SCHEMA,
                startTime: TIME_PROP,
                endTime: TIME_PROP,
              },
              required: ["room", "startTime", "endTime"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "contents", "phoneNum", "date", "plan"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_split_reservation",
      description:
        "직전에 propose_split_reservation으로 제안하고 사용자가 다음 메시지에서 명시적으로 동의한 분할 예약 계획 전체를 실제로 CJ 시스템에 확정 생성한다(각 구간을 순차 실행, 중간 실패 시 이미 만든 구간은 자동 취소됨). 사용자의 명시적 동의 없이 호출하지 말 것.",
      parameters: {
        type: "object",
        properties: {
          confirmationToken: { type: "string", description: "propose_split_reservation 응답의 confirmationToken" },
        },
        required: ["confirmationToken"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_modify_reservation",
      description:
        "이미 대상이 명확히 특정된(find_reservation_candidates 결과가 정확히 1건인) 기존 예약의 회의실/시간 변경을 제안한다. newRoom을 생략하면 회의실 유지, newDate/newStartTime/newEndTime을 생략하면 해당 값 유지. 아직 실행하지 않음 — confirmationToken 반환.",
      parameters: {
        type: "object",
        properties: {
          reservationId: { type: "string", description: "변경 대상 예약 id (find_reservation_candidates 결과에서 정확히 특정된 1건)" },
          newRoom: ROOM_SCHEMA,
          newDate: DATE_PROP,
          newStartTime: TIME_PROP,
          newEndTime: TIME_PROP,
        },
        required: ["reservationId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_modify_reservation",
      description:
        "직전에 propose_modify_reservation으로 제안하고 사용자가 다음 메시지에서 명시적으로 동의한 변경을 실제로 실행한다. 사용자의 명시적 동의 없이 호출하지 말 것.",
      parameters: {
        type: "object",
        properties: {
          confirmationToken: { type: "string", description: "propose_modify_reservation 응답의 confirmationToken" },
        },
        required: ["confirmationToken"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_cancel_reservation",
      description:
        "이미 대상이 명확히 특정된 기존 예약의 취소를 제안한다. 대상이 분할 예약(긴 회의) 그룹의 일부이고 scope를 지정하지 않으면, 실행 대신 '전체 취소/이 회의실만 취소' 중 무엇인지 되물어야 하는 상태를 반환한다(기본값을 임의로 정하지 않음). 아직 실행하지 않음 — confirmationToken 반환.",
      parameters: {
        type: "object",
        properties: {
          reservationId: { type: "string", description: "취소 대상 예약 id (find_reservation_candidates 결과에서 정확히 특정된 1건)" },
          scope: {
            type: "string",
            enum: ["single", "entire_group"],
            description: "분할 예약 그룹의 일부일 때만 필요. single=이 구간만 취소, entire_group=전체 취소. 사용자가 명시하지 않았다면 생략하고, 서버가 되물어야 할 때 그 안내를 그대로 사용자에게 전달할 것.",
          },
        },
        required: ["reservationId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_cancel_reservation",
      description:
        "직전에 propose_cancel_reservation으로 제안하고 사용자가 다음 메시지에서 명시적으로 동의한 취소를 실제로 실행한다. 사용자의 명시적 동의 없이 호출하지 말 것.",
      parameters: {
        type: "object",
        properties: {
          confirmationToken: { type: "string", description: "propose_cancel_reservation 응답의 confirmationToken" },
        },
        required: ["confirmationToken"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_preferred_room",
      description:
        '사용자가 선호 회의실을 추가/등록하고 싶어할 때 사용(예: "선호 회의실에 14F-2 추가해줘", "회원가입할 때 못 넣었는데 3F-6도 선호로 넣어줘"). 이미 등록돼 있으면 조용히 무시된다. 되돌리기 쉬운 작업(remove_preferred_room으로 취소 가능)이므로 별도 확인 없이 바로 실행해도 된다. 갱신된 전체 선호 회의실 목록(우선순위 순)을 반환한다.',
      parameters: {
        type: "object",
        properties: {
          roomName: { type: "string", description: '정식 회의실명(예: "14F-2"). 회의실 목록에서 가장 가까운 이름으로 매칭할 것.' },
        },
        required: ["roomName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_preferred_room",
      description:
        '사용자가 선호 회의실을 제거/삭제하고 싶어할 때 사용(예: "선호 회의실에서 3F-6 빼줘"). 등록돼 있지 않으면 조용히 무시된다. 되돌리기 쉬운 작업(add_preferred_room으로 취소 가능)이므로 별도 확인 없이 바로 실행해도 된다. 갱신된 전체 선호 회의실 목록(우선순위 순)을 반환한다.',
      parameters: {
        type: "object",
        properties: {
          roomName: { type: "string", description: "정식 회의실명" },
        },
        required: ["roomName"],
        additionalProperties: false,
      },
    },
  },
];

export const TOOL_NAMES = toolSchemas.map((t) => t.function.name);
