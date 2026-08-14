import "./PreferredRoomPicker.css";
import { Chip } from "../../components";
import type { Room } from "../../types/room";

// 회원가입 폼이 다룰 수 있는 우선순위 상한. 회의실 총량(26개)에 비해 의미 있는 선택지는
// 소수이므로 실용적으로 제한한다(도메인 정의서에 상한 명시는 없음 — 오버엔지니어링 방지 목적).
const MAX_PRIORITY_COUNT = 5;

export interface PreferredRoomPickerProps {
  rooms: Room[];
  isLoading: boolean;
  loadError: boolean;
  /** 선택 순서대로의 room id 배열(= 우선순위). */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * 선호 회의실 우선순위 선택 UI — `design_recom/README-auth.md` 8번 기준.
 * 칩을 누른 순서가 그대로 우선순위가 된다(다시 누르면 해제 + 뒤 순번이 앞당겨짐).
 * 챗봇 카드(ChatPage.tsx)의 회의실 칩과 동일한 `Chip` 컴포넌트를 재사용한다.
 */
export function PreferredRoomPicker({ rooms, isLoading, loadError, value, onChange }: PreferredRoomPickerProps) {
  const disabled = isLoading || loadError;

  function toggleRoom(roomId: string) {
    if (value.includes(roomId)) {
      onChange(value.filter((id) => id !== roomId));
      return;
    }
    if (value.length >= MAX_PRIORITY_COUNT) return;
    onChange([...value, roomId]);
  }

  return (
    <fieldset className="room-picker">
      <legend className="room-picker-legend">선호 회의실</legend>
      <p className="room-picker-hint">
        자주 쓰는 순서대로 눌러주세요. 누른 순서가 추천 우선순위가 됩니다. (선택 입력, 최대 {MAX_PRIORITY_COUNT}곳)
      </p>

      {loadError && (
        <p className="room-picker-error" role="alert">
          회의실 목록을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.
        </p>
      )}

      {!loadError && isLoading && <p className="room-picker-loading">회의실 목록을 불러오는 중…</p>}

      {!loadError && !isLoading && rooms.length > 0 && (
        <div className="room-picker-chips">
          {rooms.map((room) => {
            const order = value.indexOf(room.id);
            const selected = order !== -1;
            const atLimit = !selected && value.length >= MAX_PRIORITY_COUNT;
            return (
              <Chip key={room.id} selected={selected} disabled={disabled || atLimit} onClick={() => toggleRoom(room.id)}>
                {selected && <span className="room-picker-chip-order">{order + 1}</span>}
                <span>
                  {room.roomName}
                  {room.floorLabel ? ` (${room.floorLabel})` : ""}
                </span>
                {room.capacity != null && <span className="room-picker-chip-cap">{room.capacity}인</span>}
              </Chip>
            );
          })}
        </div>
      )}

      {!loadError && !isLoading && (
        <div className="room-picker-summary">
          <span className="room-picker-summary-text">
            {value.length > 0
              ? `우선순위 · ${value.map((id) => rooms.find((room) => room.id === id)?.roomName ?? id).join(" → ")}`
              : "선택한 회의실이 없어요. 비워두면 매번 전체 목록에서 추천해요."}
          </span>
          {value.length > 0 && (
            <button type="button" className="room-picker-clear" onClick={() => onChange([])}>
              모두 지우기
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
