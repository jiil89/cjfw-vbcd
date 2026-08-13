// Vercel Serverless Functions 진입점 — app.ts를 감싸는 얇은 핸들러.
// BE-1 범위에서는 실제 Vercel 배포는 하지 않고, 로컬에서 구조만 맞춰둔다.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../src/app";

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app(req as never, res as never);
}
