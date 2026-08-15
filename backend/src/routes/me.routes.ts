// FE-5 사이드바("오늘 예약"/"선호 회의실") 지원용 — 로그인한 본인의 컨텍스트만 읽는
// 읽기 전용 엔드포인트 2개. 예약 생성/변경/취소는 여기 없다 — 그건 BE-7이 두 단계
// (propose→confirm) 확인 게이트로 강제하는 POST /chat/messages 한 경로로만 가능해야
// 하므로, 별도 REST write 경로를 새로 만들지 않는다(Hallmark "콘텐츠 조작 금지" 원칙과
// 같은 결로, 사이드바에 실제 데이터 없이 목업 문구를 고정 노출하지 않기 위한 최소 추가).

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { findPreferredRoomsByUserId } from "../db/repositories/userPreferredRoomRepository";
import { getMyReservations } from "../tools/myReservations.tool";
import {
  changeAppPassword,
  changeCjWorldPassword,
  CjWorldPasswordInvalidError,
  CurrentAppPasswordMismatchError,
  UserNotFoundError,
} from "../services/passwordService";

/** 새 앱 로그인 비밀번호 최소 길이. */
const MIN_APP_PASSWORD_LENGTH = 8;

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

// CJ WORLD PW 재등록 — 사용자가 CJ에서 비밀번호를 바꾸면 우리가 보관 중인 값이 낡아져
// 조회/예약이 전부 실패한다. 그때 스스로 복구할 수 있는 유일한 경로다.
// 실제 CJ 로그인으로 검증하므로 응답이 수 초 걸릴 수 있다(브라우저 자동화).
meRouter.patch("/cj-world-password", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { new_cj_world_password } = req.body ?? {};

  if (typeof new_cj_world_password !== "string" || new_cj_world_password === "") {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "new_cj_world_password는 필수입니다." },
    });
    return;
  }

  try {
    await changeCjWorldPassword(req.user!.userId, new_cj_world_password);
    res.status(204).end();
  } catch (error) {
    if (error instanceof CjWorldPasswordInvalidError) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[routes/me] CJ WORLD PW 변경 실패", error);
    res.status(502).json({
      error: { code: "CJ_INTEGRATION_ERROR", message: "CJ 시스템 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    });
  }
});

// 앱 로그인 비밀번호 변경 — 현재 비밀번호 확인 후 교체하고, 기존 세션(refresh 토큰)을 끊는다.
meRouter.patch("/app-password", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { current_app_password, new_app_password } = req.body ?? {};

  if (typeof current_app_password !== "string" || typeof new_app_password !== "string") {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "current_app_password, new_app_password는 필수입니다." },
    });
    return;
  }

  if (new_app_password.length < MIN_APP_PASSWORD_LENGTH) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: `새 비밀번호는 ${MIN_APP_PASSWORD_LENGTH}자 이상이어야 합니다.`,
      },
    });
    return;
  }

  try {
    await changeAppPassword(req.user!.userId, current_app_password, new_app_password);
    res.status(204).end();
  } catch (error) {
    if (error instanceof CurrentAppPasswordMismatchError) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof UserNotFoundError) {
      res.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[routes/me] 앱 비밀번호 변경 실패", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "비밀번호 변경 중 오류가 발생했습니다." },
    });
  }
});
