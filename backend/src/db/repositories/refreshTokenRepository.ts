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
