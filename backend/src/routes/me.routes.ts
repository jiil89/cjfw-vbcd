// FE-5 사이드바("오늘 예약"/"선호 회의실") 지원용 — 로그인한 본인의 컨텍스트만 읽는
// 읽기 전용 엔드포인트 2개. 예약 생성/변경/취소는 여기 없다 — 그건 BE-7이 두 단계
// (propose→confirm) 확인 게이트로 강제하는 POST /chat/messages 한 경로로만 가능해야
// 하므로, 별도 REST write 경로를 새로 만들지 않는다(Hallmark "콘텐츠 조작 금지" 원칙과
// 같은 결로, 사이드바에 실제 데이터 없이 목업 문구를 고정 노출하지 않기 위한 최소 추가).

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { findPreferredRoomsByUserId } from "../db/repositories/userPreferredRoomRepository";
import { getMyReservations } from "../tools/myReservations.tool";

export const meRouter = Router();

// 우선순위(1이 최우선) 순서로 이미 정렬되어 반환된다 — 배열 인덱스+1이 곧 순위.
meRouter.get("/preferred-rooms", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const rooms = await findPreferredRoomsByUserId(req.user!.userId);
  res.status(200).json(rooms);
});

// 사이드바 "오늘 예약" 전용 — 범위를 오늘 하루로 고정한다(다른 기간 조회는 챗봇으로).
meRouter.get("/reservations/today", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const groups = await getMyReservations(req.user!.userId, { fromDate: today, toDate: today });
    res.status(200).json(groups);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[routes/me] 오늘 예약 조회 실패", error);
    res.status(502).json({
      error: { code: "CJ_INTEGRATION_ERROR", message: "예약 조회 중 오류가 발생했습니다." },
    });
  }
});
