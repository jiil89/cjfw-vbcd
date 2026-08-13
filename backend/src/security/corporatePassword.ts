// CJ 사내 계정 비밀번호 전용 암호화/복호화 모듈.
//
// 5-project-principle.md §1/§3: 사내 계정 비밀번호(encryptedPassword)는 CJ 자동화
// 로그인에 다시 사용해야 하므로 "복호화 가능한" 암호화여야 한다. 앱 로그인 비밀번호
// (appPasswordHash, security/appPassword.ts)와 절대 같은 함수/파일에서 다루지 않는다.
//
// Node 내장 crypto의 AES-256-GCM 사용 — 새 npm 의존성을 추가하지 않는다.
// CREDENTIAL_ENCRYPTION_KEY(.env)는 JWT 시크릿과 완전히 분리된 별도 키다.

import crypto from "node:crypto";
import { config } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // GCM 권장 IV 길이
const AUTH_TAG_LENGTH_BYTES = 16;

// CREDENTIAL_ENCRYPTION_KEY는 사람이 만든 임의 길이의 문자열일 수 있으므로,
// sha256으로 정확히 32바이트(AES-256 키 길이)로 정규화한다.
function deriveEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(config.credentialEncryptionKey, "utf8").digest();
}

const encryptionKey = deriveEncryptionKey();

/**
 * CJ 사내 계정 비밀번호(평문)를 복호화 가능한 형태로 암호화한다.
 * 결과 문자열 형식: base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)
 */
export function encryptCorporatePassword(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    "."
  );
}

/**
 * encryptCorporatePassword로 암호화된 값을 CJ 자동화 로그인을 위해 평문으로 복호화한다.
 * 이 함수의 반환값은 CJ 자동화 계층 밖으로 넘기지 않는다 (5-project-principle.md §2).
 */
export function decryptCorporatePassword(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("[security/corporatePassword] 암호문 형식이 올바르지 않습니다.");
  }

  const [ivPart, authTagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(authTagPart, "base64");
  const data = Buffer.from(dataPart, "base64");

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("[security/corporatePassword] 인증 태그 길이가 올바르지 않습니다.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}
