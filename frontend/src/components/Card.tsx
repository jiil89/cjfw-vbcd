import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import "./Card.css";

export type CardRadius = "lg" | "xl";

function cardClassName(radius: CardRadius, bordered: boolean, extra: string[], className?: string) {
  return [
    "card",
    radius === "xl" ? "card-radius-xl" : "card-radius-lg",
    bordered ? "card-bordered" : "",
    ...extra,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** lg(12px) = DESIGN.md feature-card, xl(16px) = product-mockup-card */
  radius?: CardRadius;
  /** 헤어라인 테두리를 그릴지 (docs/design/chatbot-shell.html의 room-card 패턴) */
  bordered?: boolean;
}

/**
 * 공용 카드(비대화형 컨테이너) — DESIGN.md `feature-card` / `product-mockup-card` 토큰을 범용화.
 * 상태: default(정적 컨테이너이므로 그 외 상태는 해당 없음 — 클릭 가능한 카드는 CardButton 사용)
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { radius = "lg", bordered = true, className, ...rest },
  ref
) {
  return <div ref={ref} className={cardClassName(radius, bordered, [], className)} {...rest} />;
});

export interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  radius?: CardRadius;
  bordered?: boolean;
  loading?: boolean;
}

/**
 * 카드 형태의 클릭 가능한 버튼 — docs/design/chatbot-shell.html의 `.room-pick` 패턴
 * (여러 회의실 중 하나를 고르는 카드). 상태: default · hover · focus-visible · active ·
 * disabled · loading
 */
export const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(function CardButton(
  { radius = "lg", bordered = true, loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cardClassName(radius, bordered, ["card-interactive", loading ? "card-loading" : ""], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && <span className="card-spinner" aria-hidden="true" />}
    </button>
  );
});
