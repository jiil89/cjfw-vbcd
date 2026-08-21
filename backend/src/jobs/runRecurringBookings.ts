// 매주 반복 예약 잡의 독립 실행 진입점. Windows 작업 스케줄러가 매일 00:01(KST)에
// 이 스크립트를 실행한다.
//
// 사용법:
//   npx tsx src/jobs/runRecurringBookings.ts            # 대상일 = 오늘(KST) + 7일(기본값)
//   npx tsx src/jobs/runRecurringBookings.ts 2026-08-24  # 대상일을 직접 지정(수동 재실행/디버깅용)
//
// 대상일을 생략하면 반드시 "오늘(KST) + MAX_ADVANCE_DAYS(7)"이어야 한다 — 그래야
// tools/reservation.tool.ts의 assertValidReservationWindow가 diffDays===7로 통과시킨다
// (recurringBookingService.ts 상단 주석 참고). new Date().toISOString()처럼 UTC 기준으로
// "오늘"을 구하면 KST 자정 근처(정확히 이 잡이 실행되는 00:01)에 날짜가 하루 어긋날 수
// 있으므로 반드시 lib/kst.ts의 toKstDate를 거친다.

import { addDaysToKstDate, toKstDate } from "../lib/kst";
import { MAX_ADVANCE_DAYS } from "../tools/businessRules";
import { runRecurringBookingsForTargetDate } from "../services/recurringBookingService";
import { pool } from "../db/pool";

function resolveTargetDate(): string {
  const argDate = process.argv[2];
  if (argDate) {
    return argDate;
  }
  return addDaysToKstDate(toKstDate(new Date()), MAX_ADVANCE_DAYS);
}

async function main(): Promise<void> {
  const targetDate = resolveTargetDate();
  console.log(`[job:recurring] 대상일 ${targetDate} 반복 예약 실행 시작`);

  const summary = await runRecurringBookingsForTargetDate(targetDate);

  console.log(
    `\n[job:recurring] 완료 — 총 ${summary.totalRules}건 중 성공 ${summary.succeeded} / 실패 ${summary.failed} / 건너뜀 ${summary.skipped}`
  );
  for (const detail of summary.details) {
    const extra = detail.roomName ? `room="${detail.roomName}"` : detail.reason ? `reason="${detail.reason}"` : "";
    console.log(`  - rule=${detail.ruleId} user=${detail.userId} status=${detail.status} ${extra}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[job:recurring] 실패:", err);
  process.exit(1);
});
