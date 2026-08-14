import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// backend/src/app.ts는 /auth, /admin, /chat, /rooms 네 경로를 루트 마운트한다(리네이밍하지 않음 —
// prompts/9-plan.md BE-9 완료조건 참고: 이미 테스트로 검증된 기존 라우트를 건드리지 않기로
// 결정됨). 그래서 프록시도 이 경로들을 각각 개별 지정한다. changeOrigin은 백엔드가
// Host 헤더를 신뢰하지 않으므로 필요 없지만, 로컬 개발 관례상 켜둔다.
// /rooms는 FE-2(회원가입 페이지, GET /rooms 공개 조회)에서 신규 추가.
const BACKEND_ORIGIN = 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/admin': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/chat': { target: BACKEND_ORIGIN, changeOrigin: true },
      '/rooms': { target: BACKEND_ORIGIN, changeOrigin: true },
    },
  },
})
