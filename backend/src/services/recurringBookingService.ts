// 매주 반복 예약 잡 본체. Windows 작업 스케줄러가 대상일 00:01(KST)에
// jobs/runRecurringBookings.ts를 통해 이 서비스를 호출한다.
//
// [배경] CJ는 오늘~7일 뒤까지만 예약을 받는다(businessRules.ts MAX_ADVANCE_DAYS=7). 그래서
// "매주 화요일"처럼 먼 미래 반복 예약을 CJ에 미리 넣어둘 수 없다 — 대신 사용자는 규칙(요일/
// 시간/회의실 우선순위)만 등록해두고, 이 잡이 대상일이 예약 가능 범위에 들어오는 순간마다
// 실제 CJ 예약을 하나씩 만든다. 이 서비스는 예약 로직을 새로 만들지 않고 tools/reservation.tool.ts의
// createReservation을 그대로 재사용한다(5-project-principle.md §2 — 예약 도메인 로직은 도구
// 계층 하나에만 있어야 한다).
//
// [assertValidReservationWindow와의 관계] 잡이 대상일=오늘(KST)+7일에 정확히 실행되므로,
// createReservation 내부의 assertValidReservationWindow가 계산하는 diffDays는 항상 정확히
// 7이 되어 통과한다. 이 서비스가 별도로 날짜 범위를 검증하지 않는 이유가 이것이다 — 대상일
// 계산 자체가 이미 그 검증을 통과하도록 설계되어 있다(jobs/runRecurringBookings.ts에서 계산).
//
// [순차 실행, 병렬 금지] createReservation은 내부적으로 그 사용자의 CJ 계정으로 로그인한
// Playwright 브라우저 세션을 사용한다. 규칙을 Promise.all 등으로 동시에 처리하면 여러
// 사용자가 동시에 CJ에 로그인하는 상황이 되는데, 이는 5-project-principle.md §4가 명시한
// "여러 브라우저의 동시 로그인이 CJ 시스템에 이상 트래픽으로 감지될 가능성이 아직 검토되지
// 않았다"는 리스크에 정확히 해당한다. 그래서 규칙을 for...of로 하나씩 순차 처리하고, 사용자
// 사이에 짧은 지연을 둔다.

import { normalizeReservationTitle } from "../tools/businessRules";
import { CjLoginError } from "../cj-automation/session";
import { createReservation, ReservationConflictError } from "../tools/reservation.tool";
import {
  findActiveRulesForWeekday,
  findRunByRuleAndDate,
  recordRun,
  type RecurringRuleWithRooms,
  type RecurringRunStatus,
} from "../db/repositories/recurringRuleRepository";
import { findUserById, hasValidUnattendedBookingConsent } from "../db/repositories/userRepository";

/** 사용자 간 CJ 로그인 시도 사이의 지연(ms). 짧은 시간에 여러 계정이 몰아치듯 로그인하지
 * 않게 하는 최소한의 안전장치 — 정교한 레이트리밋이 아니라 고정 지연이면 충분하다. */
const INTER_RULE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunDetail {
  ruleId: string;
  userId: string;
  status: RecurringRunStatus;
  roomName?: string;
  reason?: string;
}

export interface RunSummary {
  targetDate: string;
  totalRules: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: RunDetail[];
}

/** 대상일(targetDate)의 요일에 해당하는 활성 규칙을 모두 순차 실행한다. */
export async function runRecurringBookingsForTargetDate(targetDate: string): Promise<RunSummary> {
  // weekday는 규칙 테이블과 동일하게 JS Date.getDay() 규약(0=일요일)을 쓴다. UTC 자정으로
  // 고정해서 파싱하므로 실행 서버의 로컬 타임존과 무관하게 targetDate 문자열 그대로의
  // 달력일에서 요일을 뽑는다(businessRules.ts의 날짜 비교 방식과 동일).
  const weekday = new Date(`${targetDate}T00:00:00Z`).getUTCDay();
  const rules = await findActiveRulesForWeekday(weekday);

  const summary: RunSummary = {
    targetDate,
    totalRules: rules.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    try {
      const detail = await runOneRule(rule, targetDate);
      summary[detail.status] += 1;
      summary.details.push(detail);
    } catch (err) {
      // 규칙 하나에서 던진 예상 못한 예외가 잡 전체를 죽이면 안 된다 — 여기서 막고 다음
      // 규칙으로 넘어간다. recordRun 자체가 실패했을 수도 있으므로 이 catch에서는 다시
      // DB에 쓰려 하지 않고 로그만 남긴다.
      console.error(`[recurringBookingService] 규칙 ${rule.id} 처리 중 예상치 못한 오류`, err);
      summary.failed += 1;
      summary.details.push({
        ruleId: rule.id,
        userId: rule.userId,
        status: "failed",
        reason: `예상치 못한 오류: ${(err as Error).message}`,
      });
    }

    if (index < rules.length - 1) {
      await sleep(INTER_RULE_DELAY_MS);
    }
  }

  return summary;
}

async function runOneRule(rule: RecurringRuleWithRooms, targetDate: string): Promise<RunDetail> {
  // 멱등성: unique(rule_id, target_date)가 DB 제약이지만, 재실행 여부를 미리 확인해 불필요한
  // CJ 호출(중복 로그인/예약 시도) 자체를 막는다. 이미 처리된 (규칙, 대상일)이면 recordRun을
  // 다시 호출하지 않는다(호출하면 unique violation).
  const existingRun = await findRunByRuleAndDate(rule.id, targetDate);
  if (existingRun) {
    return {
      ruleId: rule.id,
      userId: rule.userId,
      status: existingRun.status,
      reason: "이미 처리된 (규칙, 대상일)이라 건너뜀",
    };
  }

  const user = await findUserById(rule.userId);
  if (!user || user.status !== "active") {
    const reason = "사용자를 찾을 수 없거나 계정이 비활성 상태입니다.";
    await recordRun({ ruleId: rule.id, targetDate, status: "skipped", failureReason: reason });
    return { ruleId: rule.id, userId: rule.userId, status: "skipped", reason };
  }

  // 실행 시점 재확인: 규칙을 만들 때는 동의가 유효했어도 그 사이 철회했을 수 있다 — 무인
  // 로그인은 매번 이 순간의 동의 상태를 다시 확인해야 한다.
  if (!hasValidUnattendedBookingConsent(user)) {
    const reason = "무인 예약 동의가 없거나 철회되었습니다.";
    await recordRun({ ruleId: rule.id, targetDate, status: "skipped", failureReason: reason });
    return { ruleId: rule.id, userId: rule.userId, status: "skipped", reason };
  }

  const title = normalizeReservationTitle(rule.title);
  let lastFailureReason = "시도할 회의실이 없습니다.";
  let lastAttemptedPriority: number | null = null;

  for (const roomEntry of rule.rooms) {
    lastAttemptedPriority = roomEntry.priority;
    try {
      const result = await createReservation(rule.userId, {
        title,
        contents: rule.contents ?? "",
        date: targetDate,
        startTime: rule.startTime,
        endTime: rule.endTime,
        room: roomEntry.room,
      });

      await recordRun({
        ruleId: rule.id,
        targetDate,
        status: "succeeded",
        reservationId: result.reservationId,
        bookedRoomId: roomEntry.room.id,
        attemptedPriority: roomEntry.priority,
      });
      return { ruleId: rule.id, userId: rule.userId, status: "succeeded", roomName: roomEntry.room.roomName };
    } catch (err) {
      if (err instanceof CjLoginError) {
        // [중요] CJ 로그인 자체가 실패한 경우는 회의실 문제가 아니므로 다음 순위를 시도해봐야
        // 똑같이 실패한다. 그런데 createReservation은 매번 getValidSession()으로 새 로그인을
        // 시도하므로, 그냥 다음 순위로 넘어가면 한 규칙에서 실패 로그인이 회의실 개수만큼(최대 3회)
        // 발생한다 — CJ WORLD PW가 만료된 사용자는 매주 자정마다 3회씩 실패 로그인이 쌓여
        // CJ 계정 잠금 정책을 자극하게 된다(4-prd.md에 기록된 미결 리스크와 같은 성격).
        // 그래서 로그인 실패는 나머지 순위를 포기하고 규칙 단위로 즉시 중단한다.
        const reason = "CJ WORLD 로그인에 실패했습니다. CJ WORLD PW를 다시 등록해주세요.";
        console.error(`[recurringBookingService] 규칙 ${rule.id} CJ 로그인 실패 — 나머지 순위 시도를 중단`, err);
        await recordRun({
          ruleId: rule.id,
          targetDate,
          status: "failed",
          attemptedPriority: roomEntry.priority,
          failureReason: reason,
        });
        return { ruleId: rule.id, userId: rule.userId, status: "failed", reason };
      }
      if (err instanceof ReservationConflictError) {
        // 이 순위 회의실이 이미 찼거나 규칙 위반 — 다음 순위로 넘어간다.
        lastFailureReason = err.message;
      } else {
        // 예상 못한 오류(CJ 시스템 오류, 무인 로그인 실패 등)도 이 순위만 포기하고 다음
        // 순위를 계속 시도한다 — 한 회의실의 오류가 나머지 순위 시도를 막지 않는다.
        console.error(
          `[recurringBookingService] 규칙 ${rule.id} ${roomEntry.room.roomName} 예약 중 예상치 못한 오류`,
          err
        );
        lastFailureReason = `${roomEntry.room.roomName} 예약 중 오류: ${(err as Error).message}`;
      }
    }
  }

  await recordRun({
    ruleId: rule.id,
    targetDate,
    status: "failed",
    attemptedPriority: lastAttemptedPriority,
    failureReason: lastFailureReason,
  });
  return { ruleId: rule.id, userId: rule.userId, status: "failed", reason: lastFailureReason };
}
