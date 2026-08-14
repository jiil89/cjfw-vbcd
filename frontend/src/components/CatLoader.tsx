import "./CatLoader.css";

export interface CatLoaderProps {
  /** 캐릭터 아래 표시할 안내 문구 (선택) */
  label?: string;
}

/**
 * 로그인처럼 오래 걸리는 대기 구간에서 지루함을 덜어주는 귀여운 로딩 캐릭터.
 * Colab의 움직이는 로딩 캐릭터에서 착안 — 이모지 + CSS 키프레임만 써서 이미지 에셋
 * 없이 구현한다. `prefers-reduced-motion`이면 통통 뛰는 동작 대신 은은한 흔들림으로
 * 대체한다(Card/Button/Chip 스피너와 동일한 모션 원칙).
 */
export function CatLoader({ label }: CatLoaderProps) {
  return (
    <div className="cat-loader" role="status" aria-live="polite">
      <div className="cat-loader-stage">
        <span className="cat-loader-emoji" aria-hidden="true">
          🐈
        </span>
        <span className="cat-loader-shadow" aria-hidden="true" />
      </div>
      {label && <p className="cat-loader-label">{label}</p>}
    </div>
  );
}
