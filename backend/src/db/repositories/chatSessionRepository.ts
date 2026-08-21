// chat_sessions 테이블 리포지토리. orchestration/sessionStore.ts의 영속화 전용 —
// state는 OrchestrationSession을 그대로 직렬화한 jsonb라 이 리포지토리는 내용을
// 해석하지 않고 그대로 담아 오고 그대로 저장한다(스키마 변경 없이 세션 모양이
// 바뀌어도 이 파일은 안 바뀐다).

import { pool } from "../pool";

export interface ChatSessionRow {
  state: unknown;
}

export async function loadChatSessionState(userId: string): Promise<unknown | null> {
  const result = await pool.query<ChatSessionRow>(
    `select state from public.chat_sessions where user_id = $1`,
    [userId]
  );
  return result.rows[0] ? result.rows[0].state : null;
}

export async function saveChatSessionState(
  userId: string,
  state: unknown,
  lastActivityAt: Date
): Promise<void> {
  await pool.query(
    `insert into public.chat_sessions (user_id, state, last_activity_at, updated_at)
     values ($1, $2, $3, now())
     on conflict (user_id) do update
       set state = excluded.state,
           last_activity_at = excluded.last_activity_at,
           updated_at = now()`,
    [userId, JSON.stringify(state), lastActivityAt]
  );
}
