// .env 파싱 모듈 (5-project-principle.md 5번)
//
// 원칙: JWT 두 키, CJ 계정 암호화 키, OpenAI 키를 절대 하나로 합치지 않고
// 각각 별도 필드로 분리해서 로드한다. 필수 값이 비어있으면 부팅 시점에
// 명확한 에러로 즉시 실패한다 (fail fast).

import path from "node:path";
import dotenv from "dotenv";

// process.cwd()가 backend/가 아닐 수도 있으므로(예: 모노레포 루트에서 실행) 이 파일 기준
// 상대 경로로 backend/.env를 명시적으로 찾는다.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `[config/env] 필수 환경변수 ${key}가 설정되지 않았습니다. backend/.env를 확인하세요.`
    );
  }
  return value;
}

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  isProd: boolean;
  port: number;

  // DB 접속 문자열. 지금은 로컬 Postgres(5432)를 가리키지만, 나중에 Supabase 커넥션
  // 풀러(6543)로 바뀔 것을 전제로 여기서 호스트/포트를 가정하지 않고 그대로 사용한다.
  databaseUrl: string;

  // JWT — access/refresh 서명 키는 용도가 다르므로 절대 같은 값을 쓰지 않는다.
  jwtAccessTokenSecret: string;
  jwtRefreshTokenSecret: string;

  // CJ 사내 계정 비밀번호 암호화 키. JWT 시크릿과 완전히 다른 별도 키.
  credentialEncryptionKey: string;

  // LLM 설정 — 모델명을 코드에 하드코딩하지 않고 환경변수로 분리.
  openaiApiKey: string;
  openaiModel: string;

  // CORS 허용 origin 목록. 와일드카드 금지 — 반드시 구체적인 origin 목록.
  allowedOrigins: string[];

  // CJ 사내 SSO 로그인 포털(cj.cj.net). 실제 로그인 폼이 있는 곳 — 여기서 로그인해야
  // cjwappr.cj.net(예약 API)에 접근 가능한 세션 쿠키(AP, NCF 등)를 얻을 수 있다.
  // (Playwright로 실사용 검증 완료: cjwappr.cj.net에 바로 접근하면 사내망 범용 404로
  // 리다이렉트되고, Azure AD가 아니라 cj.cj.net 자체 로그인 폼을 사용한다.)
  cjPortalBaseUrl: string;

  // CJ 사내 회의실 예약 시스템(ASMX API) 베이스 URL. 비밀값이 아니므로 requireEnv 대상이
  // 아니고, 기본값(cjwappr.cj.net)을 두되 환경변수로 덮어쓸 수 있게 한다.
  cjBaseUrl: string;
}

function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];

  const port = Number(process.env.PORT ?? "3000");
  if (Number.isNaN(port)) {
    throw new Error("[config/env] PORT는 숫자여야 합니다.");
  }

  const allowedOrigins = requireEnv("ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length === 0) {
    throw new Error("[config/env] ALLOWED_ORIGINS에 최소 1개 이상의 origin이 필요합니다.");
  }

  return {
    nodeEnv,
    isProd: nodeEnv === "production",
    port,
    databaseUrl: requireEnv("DATABASE_URL"),
    jwtAccessTokenSecret: requireEnv("JWT_ACCESS_TOKEN_SECRET"),
    jwtRefreshTokenSecret: requireEnv("JWT_REFRESH_TOKEN_SECRET"),
    credentialEncryptionKey: requireEnv("CREDENTIAL_ENCRYPTION_KEY"),
    openaiApiKey: requireEnv("OPENAI_API_KEY"),
    openaiModel: requireEnv("OPENAI_MODEL"),
    allowedOrigins,
    cjPortalBaseUrl: process.env.CJ_PORTAL_BASE_URL?.trim() || "https://cj.cj.net",
    cjBaseUrl: process.env.CJ_BASE_URL?.trim() || "https://cjwappr.cj.net",
  };
}

export const config: AppConfig = loadConfig();
