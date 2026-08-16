/**
 * 브랜드 마크 아이콘 — AI 스파클.
 *
 * 원래는 "회의실"의 첫 글자인 "회"를 검은 사각형에 넣은 임시 텍스트 로고였는데,
 * 글자 하나만 덩그러니 있어 의미가 안 읽힌다는 지적을 받아 아이콘으로 교체했다.
 * 이 서비스의 정체성은 "회의실"이 아니라 **AI 에이전트**이므로 AI를 뜻하는 보편적
 * 기호인 4점 스파클을 쓴다.
 *
 * 색은 DESIGN.md의 Fin Orange — 이 앱에서 AI 요소를 나타내는 색(챗봇 답변 아바타와
 * 동일)이라 브랜드 마크에도 같은 의미로 쓴다. 사각형 배경/크기는 각 화면의 기존
 * 클래스(.chat-brand-mark / .login-logo / .register-logo)가 계속 담당하고, 이
 * 컴포넌트는 그 안에 들어갈 아이콘만 그린다.
 */
export function BrandMarkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2 L14.1 9.9 L22 12 L14.1 14.1 L12 22 L9.9 14.1 L2 12 L9.9 9.9 Z"
        fill="currentColor"
      />
    </svg>
  );
}
