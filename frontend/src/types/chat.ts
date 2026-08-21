import type { Room } from "./room";

// backend/src/orchestration/orchestrator.ts의 ChatProposal/OrchestratorReply,
// backend/src/routes/chat.routes.ts의 POST /chat/messages 응답과 1:1로 맞춘다.
export interface ChatProposal {
  tool: string;
  data: unknown;
}

export interface ChatMessageResponse {
  reply: string;
  proposal: ChatProposal | null;
  elapsed_ms: number;
}

// propose_create_reservation 결과 — orchestrator.ts executeTool 참고.
export interface ProposeCreateReservationData {
  confirmationToken: string;
  summary: string;
  requiresUserConfirmation: true;
  room: Room;
  date: string;
  startTime: string;
  endTime: string;
}

// propose_split_reservation 결과.
export interface ProposeSplitReservationData {
  confirmationToken: string;
  summary: string;
  requiresUserConfirmation: true;
  date: string;
  segments: Array<{ room: Room; startTime: string; endTime: string }>;
}

// propose_modify_reservation / propose_cancel_reservation 결과 — 구조화된 room/time 필드는
// 아직 없다(요약 문자열만). FE-5는 이 경우 일반 확인 카드로 폴백한다.
export interface GenericProposalData {
  confirmationToken: string;
  summary: string;
  requiresUserConfirmation: true;
}

// confirm_* 결과 공통 형태.
export interface ConfirmedResultData {
  status: "confirmed";
  [key: string]: unknown;
}

// check_availability 결과.
export interface CheckAvailabilityData {
  preferred: Room[];
  others: Room[];
  /** 요청한 층(requestedFloorLabel)에 자리가 하나도 없을 때만 채워진다 — 같은 날짜·시간에
   * 다른 층에서 예약 가능한 회의실. 되묻지 않고 바로 대안으로 보여주기 위한 값. */
  sameTimeOtherFloors?: Room[];
  requestedFloorLabel?: string | null;
  date: string;
  startTime: string;
  endTime: string;
}

// GET /me/reservations/today — backend/src/tools/myReservations.tool.ts의 MyReservationGroup과 동일.
export interface MyReservationGroup {
  reservationRequestId: string | null;
  title: string;
  isSplit: boolean;
  segments: Array<{
    reservationId: string;
    roomName: string | null;
    startAt: string;
    endAt: string;
    cjSeq: string | null;
  }>;
}

// get_my_reservations 결과.
export interface GetMyReservationsData {
  groups: MyReservationGroup[];
}

// find_reservation_candidates 결과 — status로 세 갈래(정확히 특정됨/후보없음/후보 여러 건).
export interface ReservationCandidate {
  reservationId: string;
  reservationRequestId: string | null;
  title: string;
  roomName: string | null;
  startAt: string;
  endAt: string;
}

export interface FindReservationCandidatesData {
  status: "resolved" | "not_found" | "ambiguous";
  message?: string;
  candidates?: ReservationCandidate[];
  reservation?: ReservationCandidate;
}
