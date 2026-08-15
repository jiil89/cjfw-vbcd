// users 테이블 리포지토리. 5-project-principle.md §3: DB 컬럼(스네이크케이스) →
// 애플리케이션 타입(camelCase) 변환은 이 리포지토리 계층에서만 한다.

import { pool } from "../pool";

export interface User {
  id: string;
  emailAlias: string;
  encryptedPassword: string;
  appPasswordHash: string;
  isAdmin: boolean;
  status: "active" | "revoked";
  approvedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  email_alias: string;
  encrypted_password: string;
  app_password_hash: string;
  is_admin: boolean;
  status: "active" | "revoked";
  approved_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    emailAlias: row.email_alias,
    encryptedPassword: row.encrypted_password,
    appPasswordHash: row.app_password_hash,
    isAdmin: row.is_admin,
    status: row.status,
    approvedAt: row.approved_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserByEmailAlias(emailAlias: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `select id, email_alias, encrypted_password, app_password_hash, is_admin, status,
            approved_at, revoked_at, created_at, updated_at
     from public.users
     where email_alias = $1`,
    [emailAlias]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findUserById(userId: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `select id, email_alias, encrypted_password, app_password_hash, is_admin, status,
            approved_at, revoked_at, created_at, updated_at
     from public.users
     where id = $1`,
    [userId]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/** CJ WORLD PW(암호문)를 교체한다. 사용자가 CJ에서 비밀번호를 바꾸면 우리가 들고 있는
 * 암호문이 낡은 값이 되어 CJ 로그인이 전부 실패하므로, 앱에서도 다시 등록할 수 있어야 한다. */
export async function updateEncryptedPassword(userId: string, encryptedPassword: string): Promise<void> {
  await pool.query(
    `update public.users set encrypted_password = $2, updated_at = now() where id = $1`,
    [userId, encryptedPassword]
  );
}

/** 앱 로그인 비밀번호 해시를 교체한다(단방향 — 평문은 어디에도 남기지 않는다). */
export async function updateAppPasswordHash(userId: string, appPasswordHash: string): Promise<void> {
  await pool.query(
    `update public.users set app_password_hash = $2, updated_at = now() where id = $1`,
    [userId, appPasswordHash]
  );
}
