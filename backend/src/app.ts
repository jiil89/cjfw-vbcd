// Express 앱 조립.

import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import swaggerUi from "swagger-ui-express";
import { config } from "./config/env";
import { pool } from "./db/pool";
import { adminRouter } from "./routes/admin.routes";
import { authRouter } from "./routes/auth.routes";
import { chatRouter } from "./routes/chat.routes";
import { meRouter } from "./routes/me.routes";
import { registrationRouter } from "./routes/registration.routes";
import { roomsRouter } from "./routes/rooms.routes";

export function createApp(): Express {
  const app = express();

  // CORS: ALLOWED_ORIGINS 기반 화이트리스트만 허용, 와일드카드 금지
  // (5-project-principle.md 5번). credentials: true는 origin이 '*'이면 동작하지
  // 않으므로 반드시 구체적인 origin 목록을 넘긴다.
  app.use(
    cors({
      origin: config.allowedOrigins,
      credentials: true,
    })
  );

  app.use(express.json());
  // Refresh Token을 httpOnly 쿠키로 주고받기 위해 필요 (5-project-principle.md §5).
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("select now()");
      res.status(200).json({ status: "ok" });
    } catch (error) {
      res.status(503).json({ status: "error", message: "database unreachable" });
    }
  });

  // [20260820 추가] docs/swagger.json을 /api-docs에서 렌더링한다. 실제 API 계약과
  // 어긋나지 않도록 지금까지는 정적 파일로만 관리했는데, 눈으로 확인하려면 매번
  // editor.swagger.io에 복붙해야 했다. process.cwd() 기준 상대경로를 쓴다 — 개발(tsx,
  // cwd=backend/)과 운영(npm start, cwd도 항상 backend/) 둘 다 이 파일 기준으로 실행되므로
  // config/env.ts의 .env 경로처럼 빌드 산출물 깊이에 따라 어긋나는 문제가 없다.
  // 프론트 SPA 폴백(아래)보다 반드시 먼저 와야 한다 — 안 그러면 브라우저가 보내는
  // Accept: text/html 때문에 이 경로도 SPA로 가로채인다.
  const swaggerPath = path.resolve(process.cwd(), "../docs/swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, "utf-8"));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }

  // [사내 노트북 서버 구성, 20260819] 빌드된 프론트엔드를 같은 프로세스/같은 포트에서 서빙한다.
  //
  // CJ 예약 시스템이 사내망에서만 접근 가능한 것이 확인되어 클라우드(Vercel) 배포를 포기하고,
  // 사내 전용 노트북 한 대에서 전부 돌리는 구성으로 바꿨다(4-prd.md 참고). 프론트를 별도
  // 프로세스로 띄우지 않고 여기서 함께 서빙하면 (1) 자동 시작/감시 대상이 하나로 줄고,
  // (2) same-origin이 되어 Refresh Token 쿠키(SameSite=Lax)와 CORS 설정이 그대로 동작한다.
  //
  // 개발 환경(Vite dev 서버 사용)에서는 이 디렉터리가 없으므로 통째로 건너뛴다.
  const frontendDist =
    process.env.FRONTEND_DIST_PATH ?? path.resolve(process.cwd(), "../frontend/dist");
  const indexHtml = path.join(frontendDist, "index.html");
  const serveFrontend = fs.existsSync(indexHtml);

  if (serveFrontend) {
    // /assets/*, favicon 등 실제로 존재하는 파일만 여기서 응답하고, 없으면 다음으로 넘어간다.
    app.use(express.static(frontendDist, { index: false }));

    // [핵심] 프론트 페이지 경로(/admin, /chat)와 백엔드 API 프리픽스(/admin, /chat)는 이름이
    // 같다. 아래 API 라우트보다 먼저 이 미들웨어를 두되, "브라우저의 페이지 이동"일 때만
    // SPA를 돌려준다 — 페이지 이동은 Accept: text/html을 보내고, httpClient의 fetch 호출은
    // 그렇지 않다(frontend/vite.config.ts의 bypassHtmlNavigation과 같은 판별 기준).
    // 이 구분이 없으면 주소창에 /admin을 직접 치거나 새로고침했을 때 화면 대신 백엔드의
    // 401 JSON이 그대로 노출된다(FE-4에서 실제로 겪은 문제).
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (!req.headers.accept?.includes("text/html")) return next();
      res.sendFile(indexHtml);
    });
  }

  // BE-2: 회원가입/로그인/JWT
  app.use("/auth", registrationRouter);
  app.use("/auth", authRouter);

  // FE-2 선행 작업: 회의실 목록 공개(anon) 조회
  app.use("/rooms", roomsRouter);

  // BE-3: Admin 승인 API
  app.use("/admin", adminRouter);

  // BE-8: 웹 챗봇 API
  app.use("/chat", chatRouter);

  // FE-5 선행 작업: 챗봇 UI 사이드바용 읽기 전용 본인 컨텍스트 조회
  app.use("/me", meRouter);

  return app;
}

// 로컬 개발 진입점 (tsx watch src/app.ts). Vercel Functions에서는 api/index.ts가
// createApp()만 재사용하고 이 블록은 실행되지 않는다.
if (require.main === module) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[backend] listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });
}
