// refresh_tokens 테이블 리포지토리. DB-3에서 추가된 폐기 이력 테이블.
// 토큰 원문은 저장하지 않고 해시값(SHA-256, authService에서 계산)만 다룬다.

import { pool } from "../pool";

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revoked: boolean;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked: boolean;
}

function toRefreshTokenRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revoked: row.revoked,
  };
}

export async function insertRefreshToken(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await pool.query(
    `insert into public.refresh_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [params.userId, params.tokenHash, params.expiresAt]
  );
}

export async function findActiveRefreshTokenByHash(
  tokenHash: string
): Promise<RefreshTokenRecord | null> {
  const result = await pool.query<RefreshTokenRow>(
    `select id, user_id, token_hash, expires_at, revoked
     from public.refresh_tokens
     where token_hash = $1
       and revoked = false
       and expires_at > now()`,
    [tokenHash]
  );
  return result.rows[0] ? toRefreshTokenRecord(result.rows[0]) : null;
}

export async function revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
  await pool.query(
    `update public.refresh_tokens
     set revoked = true, revoked_at = now()
     where token_hash = $1 and revoked = false`,
    [tokenHash]
  );
}

/** 해당 사용자의 살아있는 refresh 토큰을 전부 폐기한다. 앱 비밀번호를 바꾸면 기존에
 * 발급된 세션은 더 이상 유효하면 안 되므로(다른 기기/탈취 세션 정리) 함께 끊는다. */
export async function revokeAllRefreshTokensByUserId(userId: string): Promise<void> {
  await pool.query(
    `update public.refresh_tokens
     set revoked = true, revoked_at = now()
     where user_id = $1 and revoked = false`,
    [userId]
  );
}
