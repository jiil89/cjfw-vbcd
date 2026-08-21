/**
 * 브랜드 마크 아이콘.
 *
 * 원래는 "회의실"의 첫 글자인 "회"를 검은 사각형에 넣은 임시 텍스트 로고였다가,
 * 4점 스파클 SVG를 거쳐 지금은 사용자가 제공한 로봇 챗봇 캐릭터(public/webpage_icon.png,
 * 파비콘과 동일한 이미지)로 통일했다. 이미지 자체가 이미 완결된 캐릭터라 사각형
 * 배경/색을 따로 씌우지 않는다 — 각 화면의 기존 래퍼 클래스(.chat-brand-mark /
 * .login-logo / .register-logo)에서 배경·색 지정을 제거하고 크기만 담당하게 했다.
 */
export function BrandMarkIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src="/webpage_icon.png"
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
