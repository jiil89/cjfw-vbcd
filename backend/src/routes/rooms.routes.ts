// GET /rooms — 공개(anon) 엔드포인트, 인증 불필요. docs/swagger.json의 Room/RoomWithAvailability
// 계약을 따른다. 회원가입 웹페이지의 선호 회의실 선택 UI(FE-2)가 사용하는 주 소비처.
//
// [범위 제한] swagger.json은 date/start_time/end_time을 함께 넘기면 CJ 사내 예약 시스템과
// 결합한 실시간 가용성(`available`)까지 함께 반환하는 것으로 명세되어 있으나, 그 경로는
// 익명 사용자가 어떤 CJ 계정으로 조회할지(BE-4 CJ 자동화는 특정 사용자 세션이 필요)가
// 아직 결정되지 않아 이번 범위(FE-2 선행 작업)에서는 구현하지 않는다. date가 오면 400으로
// 명확히 거부한다 — 조용히 무시하고 잘못된 결과를 주지 않는다.

import { Router } from "express";
import { findBookableRoomsFiltered, findRoomById } from "../db/repositories/roomRepository";

export const roomsRouter = Router();

roomsRouter.get("/", async (req, res) => {
  const { min_capacity, floor_label, date } = req.query;

  if (date !== undefined) {
    res.status(400).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "date 기반 실시간 가용성 조회는 아직 지원하지 않습니다. min_capacity/floor_label만 사용하세요.",
      },
    });
    return;
  }

  let minCapacity: number | undefined;
  if (min_capacity !== undefined) {
    minCapacity = Number(min_capacity);
    if (!Number.isFinite(minCapacity) || minCapacity < 1) {
      res.status(400).json({
        error: { code: "INVALID_REQUEST", message: "min_capacity는 1 이상의 정수여야 합니다." },
      });
      return;
    }
  }

  const floorLabel = typeof floor_label === "string" ? floor_label : undefined;

  const rooms = await findBookableRoomsFiltered({ minCapacity, floorLabel });
  res.status(200).json(rooms);
});

roomsRouter.get("/:id", async (req, res) => {
  const room = await findRoomById(req.params.id);
  if (!room) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "회의실을 찾을 수 없습니다." } });
    return;
  }
  res.status(200).json(room);
});
