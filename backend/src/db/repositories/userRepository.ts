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
  /** 매주 반복 예약을 위해 서버가 이 사용자의 CJ 계정으로 무인(unattended) 로그인하는 것에
   * 동의한 시각. null이면 동의한 적 없음(20260817 마이그레이션, recurringRuleRepository 참고). */
  unattendedBookingConsentAt: string | null;
  /** 위 동의를 철회한 시각. null이면 아직 철회 안 함. */
  unattendedBookingConsentRevokedAt: string | null;
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
  unattended_booking_consent_at: string | Date | null;
  unattended_booking_consent_revoked_at: string | Date | null;
}

const USER_COLUMNS =
  "id, email_alias, encrypted_password, app_password_hash, is_admin, status, approved_at, revoked_at, created_at, updated_at, unattended_booking_consent_at, unattended_booking_consent_revoked_at";

// unattended_booking_consent_at/revoked_at은 timestamptz라 node-postgres가 실제로는 Date
// 객체로 돌려준다(reservationRepository.ts와 동일한 이유). 새로 추가하는 이 두 컬럼만
// 정규화한다 — 기존 approved_at/revoked_at은 이번 작업 범위가 아니라 손대지 않는다.
function toIsoStringOrNull(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
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
    unattendedBookingConsentAt: toIsoStringOrNull(row.unattended_booking_consent_at),
    unattendedBookingConsentRevokedAt: toIsoStringOrNull(row.unattended_booking_consent_revoked_at),
  };
}

/** 유효한 무인 예약 동의 여부 — 동의했고 아직 철회하지 않은 경우만 true
 * (20260817 마이그레이션 주석의 판단 기준 그대로). */
export function hasValidUnattendedBookingConsent(
  user: Pick<User, "unattendedBookingConsentAt" | "unattendedBookingConsentRevokedAt">
): boolean {
  return user.unattendedBookingConsentAt !== null && user.unattendedBookingConsentRevokedAt === null;
}

export async function findUserByEmailAlias(emailAlias: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `select ${USER_COLUMNS} from public.users where email_alias = $1`,
    [emailAlias]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findUserById(userId: string): Promise<User | null> {
  const result = await pool.query<UserRow>(`select ${USER_COLUMNS} from public.users where id = $1`, [
    userId,
  ]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/** 매주 반복 예약을 위한 무인 CJ 로그인에 동의한다. 재동의(이전에 철회했다가 다시 동의)도
 * 이 함수 하나로 처리된다 — 철회 기록을 지우고 동의 시각을 새로 찍는다. */
export async function setUnattendedBookingConsent(userId: string): Promise<void> {
  await pool.query(
    `update public.users
     set unattended_booking_consent_at = now(),
         unattended_booking_consent_revoked_at = null,
         updated_at = now()
     where id = $1`,
    [userId]
  );
}

/** 무인 예약 동의를 철회한다. 이 사용자의 반복 예약 규칙을 비활성화하는 것은 호출자
 * (routes/me.routes.ts)가 recurringRuleRepository.deactivateAllRulesByUserId와 함께 처리한다 —
 * "동의 철회 = 규칙 비활성화"는 users 테이블만의 책임이 아니라서 이 함수에 억지로 합치지 않는다. */
export async function revokeUnattendedBookingConsent(userId: string): Promise<void> {
  await pool.query(
    `update public.users
     set unattended_booking_consent_revoked_at = now(),
         updated_at = now()
     where id = $1`,
    [userId]
  );
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
