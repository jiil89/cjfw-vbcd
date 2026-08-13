import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Chip.css";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 선택된 상태(예: 필터 칩) — true면 잉크 배경으로 반전 */
  selected?: boolean;
  loading?: boolean;
}

/**
 * 빠른명령/필터 칩 — docs/design/chatbot-shell.html `.chip` 패턴
 * (하단 입력창 위 "오늘 내 예약 조회" 등 빠른명령 버튼과 동일 스타일).
 * 상태: default · hover · focus-visible · active · disabled · loading · selected
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, loading = false, disabled, className, children, ...rest },
  ref
) {
  const classes = [
    "chip",
    selected ? "chip-selected" : "",
    loading ? "chip-loading" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-pressed={selected}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="chip-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});
