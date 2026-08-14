// POST /chat/messages — 웹 챗봇 UI가 호출하는 유일한 엔드포인트.
// requireAuth로 로그인 세션(Access Token)을 검증하고, BE-7 오케스트레이터
// (orchestration/orchestrator.ts의 handleUserMessage)를 호출해 응답을 그대로 반환한다.
//
// BE-8 완료조건 "콜드스타트 처리중 표시" 관련 설계 판단:
// CJ 자동화(Playwright)가 매 요청 로그인부터 다시 하므로 응답까지 수 초~수십 초가 걸릴
// 수 있다(5-project-principle.md §5 "콜드스타트/처리 지연에 대한 사용자 안내"). 이 요청/
// 응답 자체는 단발성(스트리밍 아님)이라 "처리 중"이라는 별도 상태를 서버가 능동적으로
// 푸시할 방법이 없고, 실제 로딩 표시는 프론트가 요청을 보낸 직후부터 응답을 받을 때까지
// 스피너를 띄우는 것으로 충분하다(FE-5 스코프). 오버엔지니어링 금지 원칙에 따라 SSE/
// 스트리밍을 여기서 새로 설계하지 않는다. 대신:
//   1) 응답 바디에 `elapsed_ms`를 포함해, 실제로 얼마나 걸렸는지 클라이언트가 가늠하고
//      로깅/UX 튜닝(예: 일정 시간 이상이면 "확인 중입니다" 문구를 더 길게 유지)에 쓸 수 있게 한다.
//   2) Vercel Hobby 함수 실행시간 한도(300초, 5-project-principle.md §5)보다 훨씬 짧은
//      선에서 명확한 타임아웃을 서버가 강제해, 응답이 무한정 걸려 있지 않고 클라이언트가
//      명확한 504 오류로 "처리 중 상태"를 종료하고 재시도 안내를 할 수 있게 한다.

import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth";
import { handleUserMessage } from "../orchestration/orchestrator";
import { withTimeout, TimeoutError } from "../lib/withTimeout";

export const chatRouter = Router();

// Vercel Hobby 함수 실행시간 한도(300초)보다 충분히 짧게 잡되, CJ 자동화 로그인+API
// 호출이 여러 번 겹칠 수 있는 긴 회의 분할 시나리오까지 감안해 120초로 설정한다.
const CHAT_MESSAGE_TIMEOUT_MS = 120_000;

chatRouter.post("/messages", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { message } = req.body ?? {};

  if (typeof message !== "string" || message.trim() === "") {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "message는 필수입니다." },
    });
    return;
  }

  const userId = req.user!.userId;
  const startedAt = Date.now();

  try {
    const result = await withTimeout(handleUserMessage(userId, message), CHAT_MESSAGE_TIMEOUT_MS);
    res.status(200).json({
      reply: result.reply,
      proposal: result.proposal,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      res.status(504).json({
        error: { code: "CHAT_TIMEOUT", message: error.message },
        elapsed_ms: Date.now() - startedAt,
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[chat.routes] message handling failed", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "메시지 처리 중 오류가 발생했습니다." },
      elapsed_ms: Date.now() - startedAt,
    });
  }
});
