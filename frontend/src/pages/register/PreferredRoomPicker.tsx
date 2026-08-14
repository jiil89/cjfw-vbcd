import { useId } from "react";
import "./PreferredRoomPicker.css";
import { Button } from "../../components";
import type { Room } from "../../types/room";

// 회원가입 폼이 다룰 수 있는 우선순위 상한. 회의실 총량(26개)에 비해 의미 있는 선택지는
// 소수이므로 실용적으로 제한한다(도메인 정의서에 상한 명시는 없음 — 오버엔지니어링 방지 목적).
const MAX_PRIORITY_COUNT = 5;

export interface PreferredRoomPickerProps {
  rooms: Room[];
  isLoading: boolean;
  loadError: boolean;
  /** 우선순위 순서의 room id 배열. 빈 문자열은 "아직 선택 안 함" 상태의 행. */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * 선호 회의실 우선순위 선택 UI — `7-wireframes.md` 1번 "[ 선호 회의실 (우선순위 순서) ]" 절.
 * 와이어프레임은 행마다 [+ 추가]/[- 삭제] 버튼을 나란히 두지만, 이 구현은 목록 끝에
 * 추가(맨 뒤에 새 우선순위 추가)/삭제(맨 뒤 우선순위 제거) 버튼 한 쌍으로 단순화했다 —
 * 기능(우선순위 추가/삭제, 비워둘 수 있음)은 동일하게 충족하면서 개별 행 삭제 버튼×N을
 * 두지 않아 오버엔지니어링을 피했다.
 */
export function PreferredRoomPicker({ rooms, isLoading, loadError, value, onChange }: PreferredRoomPickerProps) {
  const baseId = useId();

  function handleSelectChange(index: number, roomId: string) {
    const next = [...value];
    next[index] = roomId;
    onChange(next);
  }

  function handleAddRow() {
    if (value.length >= MAX_PRIORITY_COUNT) return;
    onChange([...value, ""]);
  }

  function handleRemoveLastRow() {
    if (value.length === 0) return;
    onChange(value.slice(0, -1));
  }

  const disabled = isLoading || loadError;
  const canAddMore = !disabled && value.length < Math.min(MAX_PRIORITY_COUNT, rooms.length || MAX_PRIORITY_COUNT);
  const canRemove = !disabled && value.length > 0;

  return (
    <fieldset className="room-picker">
      <legend className="room-picker-legend">선호 회의실 (우선순위 순서)</legend>
      <p className="room-picker-hint">선택 입력 — 비워둘 수 있음</p>

      {loadError && (
        <p className="room-picker-error" role="alert">
          회의실 목록을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.
        </p>
      )}

      {!loadError && isLoading && <p className="room-picker-loading">회의실 목록을 불러오는 중…</p>}

      {!loadError && !isLoading && value.length === 0 && (
        <p className="room-picker-empty">아직 선택한 회의실이 없습니다. 필요하면 아래 [+ 추가]를 눌러주세요.</p>
      )}

      {!loadError && value.length > 0 && (
        <div className="room-picker-rows">
          {value.map((roomId, index) => {
            const usedElsewhere = new Set(value.filter((_, i) => i !== index).filter(Boolean));
            const options = rooms.filter((room) => room.id === roomId || !usedElsewhere.has(room.id));
            const selectId = `${baseId}-priority-${index}`;
            return (
              <div className="room-picker-row" key={index}>
                <label className="room-picker-row-label" htmlFor={selectId}>
                  {index + 1}순위
                </label>
                <select
                  id={selectId}
                  className="room-picker-select"
                  value={roomId}
                  disabled={disabled}
                  onChange={(event) => handleSelectChange(index, event.target.value)}
                >
                  <option value="">회의실 선택</option>
                  {options.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.roomName}
                      {room.floorLabel ? ` (${room.floorLabel})` : ""}
                      {room.capacity ? ` · ${room.capacity}인` : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div className="room-picker-actions">
        <Button variant="ghost" size="sm" onClick={handleAddRow} disabled={!canAddMore}>
          + 추가
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRemoveLastRow} disabled={!canRemove}>
          - 삭제
        </Button>
      </div>
    </fieldset>
  );
}
