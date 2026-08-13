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
