import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./TextInput.css";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  /** 라벨 행 우측에 넣는 보조 액션(예: 비밀번호 표시/숨기기 토글 버튼) */
  labelAction?: ReactNode;
  /** 필드 아래 보조 설명(도움말). errorMessage가 있으면 그 대신 에러가 표시된다 */
  helpText?: string;
  errorMessage?: string;
  /** 값 검증 성공(예: 비밀번호 확인 일치) — 초록 테두리 + 체크 표시 */
  success?: boolean;
  /** 비동기 검증 중(예: 중복 ID 확인) — 우측에 스피너 표시, 입력은 막지 않음 */
  loading?: boolean;
}

/**
 * 공용 텍스트 입력 — DESIGN.md `text-input` / `text-input-focused` 토큰 기준.
 * 상태: default · hover · focus-visible · active(입력 중) · disabled · loading · error · success
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, labelAction, helpText, errorMessage, success = false, loading = false, disabled, className, id, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = Boolean(errorMessage);

  const wrapClasses = [
    "text-input-wrap",
    hasError ? "text-input-wrap-error" : "",
    success && !hasError ? "text-input-wrap-success" : "",
    disabled ? "text-input-wrap-disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClasses}>
      {(label || labelAction) && (
        <div className="text-input-label-row">
          {label && (
            <label className="text-input-label" htmlFor={inputId}>
              {label}
            </label>
          )}
          {labelAction}
        </div>
      )}
      <div className="text-input-field">
        <input
          ref={ref}
          id={inputId}
          className="text-input"
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={helpText || errorMessage ? `${inputId}-desc` : undefined}
          {...rest}
        />
        {loading && <span className="text-input-spinner" aria-hidden="true" />}
        {!loading && success && !hasError && (
          <span className="text-input-success-icon" aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      {(helpText || errorMessage) && (
        <p id={`${inputId}-desc`} className={hasError ? "text-input-error-text" : "text-input-help-text"}>
          {errorMessage || helpText}
        </p>
      )}
    </div>
  );
});
