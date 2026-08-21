// .env 파싱 모듈 (5-project-principle.md 5번)
//
// 원칙: JWT 두 키, CJ 계정 암호화 키, OpenAI 키를 절대 하나로 합치지 않고
// 각각 별도 필드로 분리해서 로드한다. 필수 값이 비어있으면 부팅 시점에
// 명확한 에러로 즉시 실패한다 (fail fast).

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// process.cwd()가 backend/가 아닐 수도 있으므로(예: 모노레포 루트에서 실행) 이 파일 기준
// 상대 경로로 backend/.env를 찾는다. 단, 이 파일의 깊이가 실행 방식에 따라 달라진다:
//   개발(tsx):      backend/src/config/env.ts       -> ../../      = backend/
//   프로덕션(빌드):  backend/dist/src/config/env.js  -> ../../../   = backend/
// [2026-08-19 발견] 원래는 ../../ 하나만 봐서, 빌드 산출물로 실행하면(npm start) .env를
// backend/dist/.env에서 찾다 실패해 "필수 환경변수가 없다"며 부팅이 죽었다. 지금까지
// 개발 서버(tsx)로만 띄워봐서 드러나지 않았던 문제 — 사내 노트북 서버 구성에서 처음 걸렸다.
// 후보 경로를 순서대로 확인하고, 하나도 없으면 dotenv를 건너뛴다(실제 환경변수로 주입하는
// 배포 방식도 유효하므로 여기서 실패시키지 않고, 값이 비면 아래 requireEnv가 잡아준다).
const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
}

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

  // CJ WORLD PW 암호화 키. JWT 시크릿과 완전히 다른 별도 키.
  credentialEncryptionKey: string;

  // LLM 설정 — 모델명을 코드에 하드코딩하지 않고 환경변수로 분리.
  openaiApiKey: string;
  openaiModel: string;

  // CORS 허용 origin 목록. 와일드카드 금지 — 반드시 구체적인 origin 목록.
  allowedOrigins: string[];

  // CJ 사내 SSO 로그인 포털. 실제 로그인 폼이 있는 곳 — 여기서 로그인해야
  // 예약 API에 접근 가능한 세션 쿠키(AP, NCF 등)를 얻을 수 있다.
  // (Playwright로 실사용 검증 완료: 예약 API 서버에 바로 접근하면 사내망 범용 404로
  // 리다이렉트되고, Azure AD가 아니라 이 포털 자체 로그인 폼을 사용한다.)
  //
  // [20260821] 이 저장소를 public으로 전환하면서, CJ 내부 시스템 호스트명이 소스에
  // 그대로 노출되는 걸 막기 위해 하드코딩 기본값을 없애고 필수 환경변수로 바꿨다.
  cjPortalBaseUrl: string;

  // CJ 사내 회의실 예약 시스템(ASMX API) 베이스 URL. 위와 같은 이유로 필수 환경변수.
  cjBaseUrl: string;

  // 이 프로젝트가 지원하는 유일한 사업장(상암S시티)의 CJ 시스템상 건물/기본층 코드.
  // 세션 워밍업(cj-automation/session.ts)과 회의실 동기화(services/roomSyncService.ts)가
  // 공유한다. [20260821] 같은 이유로 하드코딩을 없애고 필수 환경변수로 뺐다.
  cjSiteAreaCode: string;
  cjSiteSubAreaCode: string;

  // roomSyncService.ts가 스캔하는 층 목록: floor_label -> CJ 시스템상 sub_area_code.
  // "3F:1128,12F:1111,..." 형식의 콤마 구분 문자열을 파싱한다. [20260821] 실제 코드값이라
  // 소스에 하드코딩하지 않고 필수 환경변수로 뺐다.
  cjFloorAreaCodes: Record<string, string>;
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

  const cjFloorAreaCodes: Record<string, string> = {};
  for (const entry of requireEnv("CJ_FLOOR_AREA_CODES").split(",")) {
    const [floorLabel, subAreaCode] = entry.split(":").map((part) => part.trim());
    if (!floorLabel || !subAreaCode) {
      throw new Error(
        `[config/env] CJ_FLOOR_AREA_CODES 형식이 올바르지 않습니다(예: "3F:1128,12F:1111"): "${entry}"`
      );
    }
    cjFloorAreaCodes[floorLabel] = subAreaCode;
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
    cjPortalBaseUrl: requireEnv("CJ_PORTAL_BASE_URL"),
    cjBaseUrl: requireEnv("CJ_BASE_URL"),
    cjSiteAreaCode: requireEnv("CJ_SITE_AREA_CODE"),
    cjSiteSubAreaCode: requireEnv("CJ_SITE_SUB_AREA_CODE"),
    cjFloorAreaCodes,
  };
}

export const config: AppConfig = loadConfig();
