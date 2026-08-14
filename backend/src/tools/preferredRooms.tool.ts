// [레이어 2] 도구 계층 — 선호 회의실 추가/제거.
// 5-project-principle.md §2: DB 리포지토리만 호출한다(CJ 자동화 불필요 — 순수 DB 작업).
//
// 대응 유스케이스: 회원가입 시 선호 회의실을 빠뜨렸거나 바꾸고 싶을 때, 챗봇 대화로
// 바로 추가/제거할 수 있게 한다(사용자 피드백, 20260814 — 지금까지는 가입 시 1회
// 입력만 가능했고 이후 수정 수단이 전혀 없었음).

import {
  addPreferredRoom as addPreferredRoomRow,
  removePreferredRoomByRoomId,
  findPreferredRoomsByUserId,
} from "../db/repositories/userPreferredRoomRepository";
import { findBookableRooms } from "../db/repositories/roomRepository";
import type { Room } from "../db/repositories/roomRepository";

export class RoomNotFoundError extends Error {
  constructor(roomName: string) {
    super(`"${roomName}" 회의실을 찾을 수 없습니다.`);
    this.name = "RoomNotFoundError";
  }
}

/** 시스템 프롬프트의 회의실 목록과 마찬가지로 정확한 이름 매칭을 전제로 한다 — 애매한
 * 표현("3층 6번방" 등)을 정식 이름으로 바꾸는 건 모델의 책임(systemPrompt.ts 4번). */
async function resolveRoomByName(roomName: string): Promise<Room> {
  const rooms = await findBookableRooms();
  const normalized = roomName.trim().toLowerCase();
  const room = rooms.find((r) => r.roomName.toLowerCase() === normalized);
  if (!room) throw new RoomNotFoundError(roomName);
  return room;
}

export async function addPreferredRoom(userId: string, roomName: string): Promise<Room[]> {
  const room = await resolveRoomByName(roomName);
  await addPreferredRoomRow(userId, room.id);
  return findPreferredRoomsByUserId(userId);
}

export async function removePreferredRoom(userId: string, roomName: string): Promise<Room[]> {
  const room = await resolveRoomByName(roomName);
  await removePreferredRoomByRoomId(userId, room.id);
  return findPreferredRoomsByUserId(userId);
}
