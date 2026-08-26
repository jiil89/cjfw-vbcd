// BE-5. 회의실 마스터데이터 동기화 서비스.
//
// DB-5에서 일회성 스크립트(`scripts/seed-rooms.ts`)로 처음 채운 rooms 테이블을,
// 실제 서비스 흐름에서 재사용 가능한 정식 함수로 승격한 것이다. 로그인은
// cj-automation/session.ts의 `loginAndGetSession(userId)`를 사용한다 — DB에 저장된
// 사용자의 암호화된 CJ WORLD 자격증명을 그 안에서 복호화해서 쓰고, 평문 비밀번호는
// 이 서비스로 넘어오지 않는다(5-project-principle.md §2).
//
// 지원 사업장(config.cjSites, 상암S시티/YTN 본사)을 순회하며 각 사업장의 층들을
// getDayPilotConfReserveList로 스캔해 실제 회의실 목록(room_code/room_name/capacity)을
// 얻고 rooms 테이블에 upsert한다. db/repositories/roomRepository.ts의
// upsertRoomIfChanged가 "값이 실제로 다를 때만 UPDATE"를 보장하므로, 이 서비스를
// 여러 번 실행해도 안전하다(멱등적 동작).
// floor_label -> sub_area_code 매핑은 listArea(type=0/1) 네트워크 트레이스로 확인한
// 값이다(seed-rooms.ts에서 승격). B1F/2F 등 실사용 회의실이 아닌 층은 도메인 정의서
// 원칙에 따라 스캔 대상에서 제외한다. [20260821] 실제 코드값이라 config로 뺐다.

import { config } from "../config/env";
import { loginAndGetSession } from "../cj-automation/session";
import { getDayPilotConfReserveList } from "../cj-automation/client";
import { upsertRoomIfChanged } from "../db/repositories/roomRepository";
import { findUserById } from "../db/repositories/userRepository";
import { toKstDate } from "../lib/kst";

interface CjRoomResource {
  name: string;
  id: string;
  html?: string;
}

interface CjFloorResource {
  name: string;
  id: string;
  children?: CjRoomResource[];
}

// getDayPilotConfReserveList 응답의 room_info/resources는 client.ts의 CjReserveGridResponse
// 타입에 아직 선언되어 있지 않다(가용성 조회 흐름에서는 쓰이지 않는 필드). 이 동기화
// 서비스에서만 필요한 형태라 여기서 지역적으로 캐스팅한다(seed-rooms.ts와 동일한 방식).
interface CjRoomListResponse {
  resources?: CjFloorResource[];
}

/** CJ 응답 HTML(예: `<span class="num_person">8인</span>3F-1`)에서 수용 인원을 파싱한다. */
function parseCapacity(html: string | undefined): number | null {
  if (!html) return null;
  const match = html.match(/num_person">(\d+)인/);
  if (!match) return null;
  return Number(match[1]);
}

export interface RoomSyncFloorResult {
  site: string;
  floorLabel: string;
  subAreaCode: string;
  roomCount: number;
  changedRoomCount: number;
  missingCapacityRoomCodes: string[];
}

export interface RoomSyncResult {
  floors: RoomSyncFloorResult[];
  totalRoomCount: number;
  totalChangedRoomCount: number;
}

/**
 * userId로 로그인해 지원 사업장(config.cjSites) 전체의 대상 층을 스캔하고 rooms
 * 테이블을 멱등적으로 upsert한다. BE-6 이후 실제 예약 흐름과 별개로, Admin 트리거나
 * CLI에서 재사용할 수 있도록 정식 함수로 둔다(스케줄러/API 엔드포인트는 이번 스코프 아님).
 */
export async function syncRoomMasterData(userId: string): Promise<RoomSyncResult> {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error(`[services/roomSyncService] 사용자를 찾을 수 없습니다: ${userId}`);
  }

  const session = await loginAndGetSession(userId);
  // [버그 수정, 20260818] CJ는 한국 시스템이라 UTC 날짜를 넘기면 자정~오전 9시 사이엔
  // 어제 날짜로 조회하게 된다. KST로 계산한다.
  const today = toKstDate(new Date());

  const floors: RoomSyncFloorResult[] = [];

  for (const site of config.cjSites) {
    for (const [floorLabel, subAreaCode] of Object.entries(site.floorAreaCodes)) {
      const res = await getDayPilotConfReserveList(session, {
        areaList: subAreaCode,
        reserveDate: today,
        emailAlias: user.emailAlias,
      });

      const resources = (res as CjRoomListResponse).resources;
      const floorResource = resources?.[0];
      const rooms = floorResource?.children ?? [];

      let changedRoomCount = 0;
      const missingCapacityRoomCodes: string[] = [];

      for (const room of rooms) {
        const capacity = parseCapacity(room.html);
        if (capacity === null) {
          missingCapacityRoomCodes.push(room.id);
        }

        const changed = await upsertRoomIfChanged({
          site: site.name,
          areaCode: site.areaCode,
          subAreaCode,
          roomCode: room.id,
          roomName: room.name,
          floorLabel,
          capacity,
        });
        if (changed) {
          changedRoomCount += 1;
        }
      }

      floors.push({
        site: site.name,
        floorLabel,
        subAreaCode,
        roomCount: rooms.length,
        changedRoomCount,
        missingCapacityRoomCodes,
      });
    }
  }

  return {
    floors,
    totalRoomCount: floors.reduce((sum, floor) => sum + floor.roomCount, 0),
    totalChangedRoomCount: floors.reduce((sum, floor) => sum + floor.changedRoomCount, 0),
  };
}
