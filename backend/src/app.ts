// Express 앱 조립.

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { config } from "./config/env";
import { pool } from "./db/pool";
import { adminRouter } from "./routes/admin.routes";
import { authRouter } from "./routes/auth.routes";
import { chatRouter } from "./routes/chat.routes";
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

  // BE-2: 회원가입/로그인/JWT
  app.use("/auth", registrationRouter);
  app.use("/auth", authRouter);

  // FE-2 선행 작업: 회의실 목록 공개(anon) 조회
  app.use("/rooms", roomsRouter);

  // BE-3: Admin 승인 API
  app.use("/admin", adminRouter);

  // BE-8: 웹 챗봇 API
  app.use("/chat", chatRouter);

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
