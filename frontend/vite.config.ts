import { defineConfig, type ProxyOptions } from 'vite'
import type { IncomingMessage } from 'node:http'
import react from '@vitejs/plugin-react'

// backend/src/app.ts는 /auth, /admin, /chat, /rooms 네 경로를 루트 마운트한다(리네이밍하지 않음 —
// docs/9-plan.md BE-9 완료조건 참고: 이미 테스트로 검증된 기존 라우트를 건드리지 않기로
// 결정됨). 그래서 프록시도 이 경로들을 각각 개별 지정한다. changeOrigin은 백엔드가
// Host 헤더를 신뢰하지 않으므로 필요 없지만, 로컬 개발 관례상 켜둔다.
// /rooms는 FE-2(회원가입 페이지, GET /rooms 공개 조회)에서 신규 추가.
// /me는 FE-5(챗봇 UI 사이드바, 본인 예약/선호 회의실 읽기 전용 조회)에서 신규 추가.
const BACKEND_ORIGIN = 'http://localhost:3000'

// [FE-4에서 발견/수정] 프론트 페이지 라우트 /admin, /chat이 백엔드 API 프리픽스와 이름이
// 같아서, 브라우저로 그 경로에 직접 진입(주소창 직접 입력, 새로고침, 북마크)하면 이
// 프록시가 그 요청 자체를 백엔드로 넘겨버려 SPA(index.html) 대신 백엔드의 JSON 401
// 응답이 그대로 떴다(실측 확인: /admin 새로고침 시 화면에 `{"error":...}` 노출). 페이지
// 내비게이션(브라우저의 최상위 이동)은 `Accept: text/html...`을 보내고, 우리 httpClient의
// fetch() 호출은 Accept 헤더를 지정하지 않아(`*/*`) 구분 가능하다 — Vite 공식 문서가 제시하는
// 방식(https://vite.dev/config/server-options#server-proxy) 그대로, html을 요청하는
// 내비게이션이면 프록시를 건너뛰고 index.html을 서빙해 SPA 라우터(React Router)가 처리하게 한다.
function bypassHtmlNavigation(req: IncomingMessage): string | undefined {
  if (req.headers.accept?.includes('html')) {
    return '/index.html'
  }
  return undefined
}

function proxyTo(): ProxyOptions {
  return { target: BACKEND_ORIGIN, changeOrigin: true, bypass: bypassHtmlNavigation }
}

export default defineConfig({
  plugins: [react()],
  server: {
    // 사내망의 다른 PC에서 내 PC의 LAN IP로 접속해 같이 쓸 수 있게 0.0.0.0으로 바인딩한다
    // (임시 공유용, 20260818) — 기본값(localhost only)이면 같은 PC에서만 접속 가능하다.
    host: true,
    // [20260821] Cloudflare Quick Tunnel(cloudflared tunnel --url http://localhost:5173)로
    // 외부 접속을 테스트할 때, Vite가 DNS 리바인딩 방지로 낯선 Host 헤더를 차단해서
    // "Blocked request... allowedHosts" 에러가 났다. Quick Tunnel은 실행할 때마다
    // 무작위 서브도메인(*.trycloudflare.com)이 새로 발급돼 하나씩 등록할 수 없으므로,
    // 접두사에 점(.)을 붙여 이 도메인의 모든 서브도메인을 허용한다(Vite 문법).
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/auth': proxyTo(),
      '/admin': proxyTo(),
      '/chat': proxyTo(),
      '/rooms': proxyTo(),
      '/me': proxyTo(),
    },
  },
})
