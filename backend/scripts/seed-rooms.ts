// BE-5. 회의실 마스터데이터 동기화 CLI 진입점.
//
// 실제 로직은 services/roomSyncService.ts(정식 서비스 함수)에 있다 — 이 스크립트는
// "DB에 이미 저장된 사용자의 자격증명으로 syncRoomMasterData를 한 번 실행한다"만
// 담당하는 얇은 래퍼다(DB-5 때의 일회성 스크립트를 대체).
//
// 평문 비밀번호를 이 스크립트가 다루지 않는다 — email_alias로 users 테이블에서
// userId를 찾아 roomSyncService에 넘기면, 그 안의 cj-automation/session.ts가
// DB에 저장된 encrypted_password를 그 자리에서 복호화해서 쓴다.
//
// 실행 방법:
//   CJ_SYNC_EMAIL_ALIAS=jiil npx tsx scripts/seed-rooms.ts
// (CJ_SYNC_EMAIL_ALIAS를 생략하면 기본값 'jiil'을 사용한다 — DB-5 때 시딩에 쓰인
// 테스트 계정과 동일)
import { findUserByEmailAlias } from "../src/db/repositories/userRepository";
import { syncRoomMasterData } from "../src/services/roomSyncService";
import { pool } from "../src/db/pool";

async function main(): Promise<void> {
  const emailAlias = process.env.CJ_SYNC_EMAIL_ALIAS?.trim() || "jiil";

  const user = await findUserByEmailAlias(emailAlias);
  if (!user) {
    throw new Error(
      `[seed-rooms] users 테이블에서 email_alias='${emailAlias}' 사용자를 찾을 수 없습니다.`
    );
  }

  console.log(`[seed-rooms] '${emailAlias}' 계정으로 회의실 마스터데이터 동기화 시작...`);
  const result = await syncRoomMasterData(user.id);

  console.log("\n[seed-rooms] 완료 요약");
  for (const floor of result.floors) {
    console.log(
      `  [${floor.site}] ${floor.floorLabel} (sub_area_code=${floor.subAreaCode}) — ${floor.roomCount}개 스캔, ${floor.changedRoomCount}개 변경`
    );
    if (floor.missingCapacityRoomCodes.length > 0) {
      console.log(
        `    경고: capacity를 확인하지 못한 회의실(room_code): ${floor.missingCapacityRoomCodes.join(", ")}`
      );
    }
  }
  console.log(
    `\n[seed-rooms] 총 ${result.totalRoomCount}개 스캔, 총 ${result.totalChangedRoomCount}개 실제 변경(멱등적 upsert)`
  );

  await pool.end();
}

main().catch((e) => {
  console.error("[seed-rooms] 실패:", e);
  process.exit(1);
});
