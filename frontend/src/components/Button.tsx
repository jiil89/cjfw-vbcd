import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "ghost";
export type ButtonSize = "md" | "sm";
export type ButtonStatus = "idle" | "success" | "error";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = DESIGN.md button-primary(잉크 배경), ghost = button-secondary(흰 배경+헤어라인) */
  variant?: ButtonVariant;
  /** md = DESIGN.md 표준(10px 18px/15px), sm = 챗봇 카드 액션 버튼 크기(docs/design/chatbot-shell.html .btn) */
  size?: ButtonSize;
  /** 비동기 처리 중 — 라벨을 흐리게 하고 스피너를 표시, 클릭을 막는다 */
  loading?: boolean;
  /** 처리 결과를 잠깐 알릴 때(success/error) 배경을 semantic 색으로 오버라이드 */
  status?: ButtonStatus;
}

/**
 * 공용 버튼 — DESIGN.md `button-primary` / `button-secondary` 토큰 기준.
 * 상태: default · hover · focus-visible · active · disabled · loading · error · success
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, status = "idle", disabled, className, children, ...rest },
  ref
) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    loading ? "btn-loading" : "",
    status !== "idle" ? `btn-status-${status}` : "",
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
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      <span className="btn-label">{children}</span>
    </button>
  );
});
