// backend/src/db/repositories/roomRepository.ts의 toRoom() 응답과 1:1로 맞춘다 (GET /rooms, GET /rooms/:id).
// (5-project-principle.md 1번: 애플리케이션 타입은 DB/백엔드 응답에서 파생시킨다.)
export interface Room {
  id: string;
  site: string;
  areaCode: string;
  subAreaCode: string;
  roomCode: string;
  roomName: string;
  floorLabel: string | null;
  capacity: number | null;
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}
