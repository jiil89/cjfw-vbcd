import type { HTMLAttributes } from "react";
import "./Badge.css";

export type BadgeTone = "neutral" | "success" | "error" | "warn";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/**
 * 뱃지/태그 — docs/design/chatbot-shell.html `.tag` / `.tag.ok` / `.status-line` 패턴.
 * 비대화형 정보 표시 요소이므로 hover/focus 상태는 없다. tone으로 성공/오류/중립을 표현한다.
 */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const classes = ["badge", `badge-${tone}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
