// 이 서비스 자체 로그인(app_password_hash) 전용 해시/검증 모듈.
//
// 5-project-principle.md §1/§3: 앱 로그인 비밀번호는 복호화가 불가능한 단방향 해시로만
// 저장한다. CJ 사내 계정 비밀번호(encryptedPassword, security/corporatePassword.ts)와
// 절대 같은 함수/파일에서 다루지 않는다.
//
// 네이티브 빌드가 필요한 bcrypt 대신, 순수 JS 구현인 bcryptjs를 사용한다
// (Vercel 서버리스 배포 환경과 이 저장소의 npm install-script 승인 정책 양쪽에서
// 네이티브 바인딩 이슈를 피하기 위함).

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashAppPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyAppPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
