// preferredRooms.tool.ts 유닛 테스트.
// [2026-08-17 발견] MAX_PREFERRED_ROOMS 상한이 회원가입 폼(프론트)에만 걸려 있고
// 챗봇의 add_preferred_room 도구에는 전혀 강제되지 않아 채팅으로는 무제한 추가가
// 가능했다. 도구 계층에도 같은 상한을 강제하도록 고친 뒤 이 테스트로 회귀를 막는다.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/repositories/userPreferredRoomRepository", () => ({
  addPreferredRoom: vi.fn(),
  removePreferredRoomByRoomId: vi.fn(),
  findPreferredRoomsByUserId: vi.fn(),
}));
vi.mock("../../db/repositories/roomRepository", () => ({ findBookableRooms: vi.fn() }));

import {
  addPreferredRoom as addPreferredRoomRow,
  findPreferredRoomsByUserId,
} from "../../db/repositories/userPreferredRoomRepository";
import { findBookableRooms } from "../../db/repositories/roomRepository";
import { addPreferredRoom, PreferredRoomLimitExceededError, RoomNotFoundError } from "../preferredRooms.tool";
import { MAX_PREFERRED_ROOMS } from "../businessRules";
import type { Room } from "../../db/repositories/roomRepository";

function makeRoom(id: string, roomName: string): Room {
  return {
    id,
    site: "상암S시티",
    areaCode: "804",
    subAreaCode: "1128",
    roomCode: id,
    roomName,
    floorLabel: "12F",
    capacity: 4,
    isBookable: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

describe("addPreferredRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`이미 ${MAX_PREFERRED_ROOMS}개가 등록된 상태에서 새 회의실을 추가하려 하면 PreferredRoomLimitExceededError를 던진다`, async () => {
    const existing = Array.from({ length: MAX_PREFERRED_ROOMS }, (_, i) => makeRoom(`room-${i}`, `12F-${i}`));
    const newRoom = makeRoom("room-new", "14F-2");
    (findBookableRooms as ReturnType<typeof vi.fn>).mockResolvedValue([...existing, newRoom]);
    (findPreferredRoomsByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

    await expect(addPreferredRoom("user-1", "14F-2")).rejects.toThrow(PreferredRoomLimitExceededError);
    expect(addPreferredRoomRow).not.toHaveBeenCalled();
  });

  it("이미 등록된 회의실을 다시 추가하는 건 상한에 걸려도 통과시킨다(on conflict do nothing과 정합)", async () => {
    const existing = Array.from({ length: MAX_PREFERRED_ROOMS }, (_, i) => makeRoom(`room-${i}`, `12F-${i}`));
    (findBookableRooms as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
    (findPreferredRoomsByUserId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    await expect(addPreferredRoom("user-1", "12F-0")).resolves.toEqual(existing);
    expect(addPreferredRoomRow).toHaveBeenCalledWith("user-1", "room-0");
  });

  it(`${MAX_PREFERRED_ROOMS}개 미만이면 정상적으로 추가한다`, async () => {
    const existing = Array.from({ length: MAX_PREFERRED_ROOMS - 1 }, (_, i) => makeRoom(`room-${i}`, `12F-${i}`));
    const newRoom = makeRoom("room-new", "14F-2");
    (findBookableRooms as ReturnType<typeof vi.fn>).mockResolvedValue([...existing, newRoom]);
    (findPreferredRoomsByUserId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce([...existing, newRoom]);

    const result = await addPreferredRoom("user-1", "14F-2");

    expect(addPreferredRoomRow).toHaveBeenCalledWith("user-1", "room-new");
    expect(result).toEqual([...existing, newRoom]);
  });

  it("존재하지 않는 회의실 이름이면 RoomNotFoundError를 던진다", async () => {
    (findBookableRooms as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(addPreferredRoom("user-1", "없는회의실")).rejects.toThrow(RoomNotFoundError);
    expect(findPreferredRoomsByUserId).not.toHaveBeenCalled();
  });
});
