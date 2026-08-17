// FE-5 사이드바("오늘 예약"/"선호 회의실") 지원용 — 로그인한 본인의 컨텍스트만 읽는
// 읽기 전용 엔드포인트 2개. 예약 생성/변경/취소는 여기 없다 — 그건 BE-7이 두 단계
// (propose→confirm) 확인 게이트로 강제하는 POST /chat/messages 한 경로로만 가능해야
// 하므로, 별도 REST write 경로를 새로 만들지 않는다(Hallmark "콘텐츠 조작 금지" 원칙과
// 같은 결로, 사이드바에 실제 데이터 없이 목업 문구를 고정 노출하지 않기 위한 최소 추가).
//
// [예외, 20260817 — 매주 반복 예약] 아래 recurring-rules/unattended-consent 엔드포인트는
// 위 원칙의 유일한 의도된 예외다. 이 엔드포인트들은 예약 자체를 만들지 않고 "예약 조건
// (요일/시간/회의실 우선순위)"만 저장한다 — 실제 CJ 예약은 여전히 이 REST 경로가 아니라
// jobs/runRecurringBookings.ts → services/recurringBookingService.ts가
// tools/reservation.tool.ts의 createReservation을 통해서만 만든다(propose→confirm 게이트를
// 우회하지 않는다). 다만 결과적으로 "사람이 개입하지 않는 예약"을 유발하므로 세 겹의
// 안전장치를 둔다:
//   1. 동의 게이트 — 유효한 unattended_booking_consent가 없으면 규칙 생성 자체가 400
//      (CONSENT_REQUIRED)으로 막힌다.
//   2. 실행 시점 재확인 — 규칙 생성 시 동의가 있었어도, 대상일에 잡이 실제로 실행되는
//      순간 다시 한 번 동의 상태를 확인한다(동의를 나중에 철회하면 그 시점부터 실행되지
//      않는다 — recurringBookingService.ts 참고).
//   3. 실행 로그 — 모든 실행(성공/실패/건너뜀)이 recurring_reservation_runs에 남아
//      GET /me/recurring-rules의 latest_run으로 항상 사용자에게 보인다.

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { findPreferredRoomsByUserId } from "../db/repositories/userPreferredRoomRepository";
import { findRoomsByIds } from "../db/repositories/roomRepository";
import {
  createRule,
  deactivateAllRulesByUserId,
  deleteRule,
  findRulesByUserId,
  setRuleActive,
  type RecurringRuleForUser,
} from "../db/repositories/recurringRuleRepository";
import {
  findUserById,
  hasValidUnattendedBookingConsent,
  revokeUnattendedBookingConsent,
  setUnattendedBookingConsent,
} from "../db/repositories/userRepository";
import { getMyReservations } from "../tools/myReservations.tool";
import {
  durationMinutes,
  isAlignedToReservationUnit,
  isWithinOperatingHours,
  MAX_SINGLE_ROOM_MINUTES,
  normalizeReservationTitle,
  OPERATING_HOURS,
  RESERVATION_UNIT_MINUTES,
} from "../tools/businessRules";
import {
  changeAppPassword,
  changeCjWorldPassword,
  CjWorldPasswordInvalidError,
  CurrentAppPasswordMismatchError,
  UserNotFoundError,
} from "../services/passwordService";

/** 새 앱 로그인 비밀번호 최소 길이. */
const MIN_APP_PASSWORD_LENGTH = 8;

/** "HH:mm" 형식 검증(00:00~23:59) — businessRules.ts의 시간 함수들은 형식이 이미 맞다는
 * 전제로 숫자 변환만 하므로, 그 전에 이 라우트에서 형식 자체를 먼저 걸러낸다. */
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 반복 예약 규칙 회의실 우선순위 최대 개수. */
const MAX_RULE_ROOMS = 3;

export const meRouter = Router();

function respondInvalidRequest(res: Response, message: string): void {
  res.status(400).json({ error: { code: "INVALID_REQUEST", message } });
}

function toApiRecurringRule(rule: RecurringRuleForUser) {
  return {
    id: rule.id,
    weekday: rule.weekday,
    start_time: rule.startTime,
    end_time: rule.endTime,
    title: rule.title,
    contents: rule.contents,
    is_active: rule.isActive,
    rooms: rule.rooms.map((entry) => ({
      room_id: entry.room.id,
      room_name: entry.room.roomName,
      floor_label: entry.room.floorLabel,
      priority: entry.priority,
    })),
    latest_run: rule.latestRun
      ? {
          target_date: rule.latestRun.targetDate,
          status: rule.latestRun.status,
          booked_room_name: rule.latestRun.bookedRoomName,
          attempted_priority: rule.latestRun.attemptedPriority,
          failure_reason: rule.latestRun.failureReason,
          executed_at: rule.latestRun.executedAt,
        }
      : null,
  };
}

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

// ---------------------------------------------------------------------------
// 매주 반복 예약 (20260817) — 상단 주석의 "예외" 절 참고.
// ---------------------------------------------------------------------------

meRouter.get("/recurring-rules", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rules = await findRulesByUserId(req.user!.userId);
    res.status(200).json(rules.map(toApiRecurringRule));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[routes/me] 반복 예약 규칙 조회 실패", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "반복 예약 규칙 조회 중 오류가 발생했습니다." },
    });
  }
});

meRouter.post("/recurring-rules", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { weekday, start_time, end_time, title, contents, room_ids } = req.body ?? {};

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    respondInvalidRequest(res, "weekday는 0(일요일)~6(토요일) 사이의 정수여야 합니다.");
    return;
  }
  if (typeof start_time !== "string" || typeof end_time !== "string" || !TIME_FORMAT.test(start_time) || !TIME_FORMAT.test(end_time)) {
    respondInvalidRequest(res, 'start_time, end_time은 "HH:mm" 형식이어야 합니다.');
    return;
  }
  if (typeof title !== "string" || title.trim() === "") {
    respondInvalidRequest(res, "title은 필수입니다.");
    return;
  }
  if (
    !Array.isArray(room_ids) ||
    room_ids.length < 1 ||
    room_ids.length > MAX_RULE_ROOMS ||
    !room_ids.every((id) => typeof id === "string" && id.trim() !== "")
  ) {
    respondInvalidRequest(res, `room_ids는 1~${MAX_RULE_ROOMS}개의 회의실 id 배열이어야 합니다.`);
    return;
  }
  if (new Set(room_ids).size !== room_ids.length) {
    respondInvalidRequest(res, "room_ids에 중복된 회의실이 있습니다.");
    return;
  }

  // 30분 단위/운영시간/2시간 제한 — businessRules.ts를 그대로 재사용한다(5-project-principle.md
  // §1: 비즈니스 규칙을 새로 만들지 않는다).
  if (!isAlignedToReservationUnit(start_time) || !isAlignedToReservationUnit(end_time)) {
    respondInvalidRequest(res, `예약 시간은 ${RESERVATION_UNIT_MINUTES}분 단위여야 합니다.`);
    return;
  }
  if (!isWithinOperatingHours(start_time, end_time)) {
    respondInvalidRequest(
      res,
      `예약 가능 시간(${OPERATING_HOURS.startTime}~${OPERATING_HOURS.endTime})을 벗어났습니다.`
    );
    return;
  }
  if (durationMinutes(start_time, end_time) > MAX_SINGLE_ROOM_MINUTES) {
    respondInvalidRequest(res, `1회 예약은 최대 ${MAX_SINGLE_ROOM_MINUTES}분(2시간)까지 가능합니다.`);
    return;
  }

  const user = await findUserById(req.user!.userId);
  if (!user || !hasValidUnattendedBookingConsent(user)) {
    res.status(400).json({
      error: {
        code: "CONSENT_REQUIRED",
        message: "매주 반복 예약을 등록하려면 무인 예약 동의(POST /me/unattended-consent)가 먼저 필요합니다.",
      },
    });
    return;
  }

  const rooms = await findRoomsByIds(room_ids);
  if (rooms.length !== room_ids.length) {
    respondInvalidRequest(res, "존재하지 않는 회의실 id가 room_ids에 포함되어 있습니다.");
    return;
  }

  try {
    const created = await createRule({
      userId: req.user!.userId,
      weekday,
      startTime: start_time,
      endTime: end_time,
      title: normalizeReservationTitle(title),
      contents: typeof contents === "string" && contents.trim() !== "" ? contents : null,
      roomIds: room_ids,
    });
    res.status(201).json({ id: created.id });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[routes/me] 반복 예약 규칙 생성 실패", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "반복 예약 규칙 생성 중 오류가 발생했습니다." },
    });
  }
});

meRouter.patch("/recurring-rules/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { is_active } = req.body ?? {};
  if (typeof is_active !== "boolean") {
    respondInvalidRequest(res, "is_active는 boolean이어야 합니다.");
    return;
  }

  try {
    const updated = await setRuleActive(req.user!.userId, req.params.id, is_active);
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "반복 예약 규칙을 찾을 수 없습니다." } });
      return;
    }
    res.status(204).end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[routes/me] 반복 예약 규칙 활성화 상태 변경 실패", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "반복 예약 규칙 변경 중 오류가 발생했습니다." },
    });
  }
});

meRouter.delete("/recurring-rules/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await deleteRule(req.user!.userId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "반복 예약 규칙을 찾을 수 없습니다." } });
      return;
    }
    res.status(204).end();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[routes/me] 반복 예약 규칙 삭제 실패", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "반복 예약 규칙 삭제 중 오류가 발생했습니다." },
    });
  }
});

meRouter.get("/unattended-consent", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "사용자를 찾을 수 없습니다." } });
    return;
  }
  res.status(200).json({
    consented: hasValidUnattendedBookingConsent(user),
    consented_at: user.unattendedBookingConsentAt,
  });
});

meRouter.post("/unattended-consent", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await setUnattendedBookingConsent(req.user!.userId);
  res.status(204).end();
});

// 철회 시 그 사용자의 모든 반복 예약 규칙을 즉시 비활성화한다 — 동의 없이는 잡이 실행 시점에
// 재확인해서 어차피 skip하지만, 규칙을 비활성 상태로 명시적으로 바꿔둬야 사용자가
// GET /me/recurring-rules에서 "꺼져 있다"는 것을 바로 확인할 수 있다.
meRouter.delete("/unattended-consent", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await revokeUnattendedBookingConsent(req.user!.userId);
  await deactivateAllRulesByUserId(req.user!.userId);
  res.status(204).end();
});
