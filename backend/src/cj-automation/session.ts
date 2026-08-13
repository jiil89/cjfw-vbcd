// CJ 자동화 계층 — 로그인/세션 확보 (5-project-principle.md §2 "CJ 자동화 계층").
//
// 이 파일은 예약 비즈니스 규칙을 전혀 모른다. 순수하게 "사내 포털(cj.cj.net)에 로그인해서
// cjwappr.cj.net(예약 API) 세션 쿠키를 확보한다"만 담당한다.
//
// [실사용 검증 완료 — 이전 버전의 추측을 대체함]
// - cjwappr.cj.net에 직접 접근하면 사내망 범용 404로 리다이렉트되어 로그인 폼 자체가 없다.
//   실제 로그인은 cj.cj.net(사내 포털)의 자체 로그인 폼에서 이루어진다. Azure AD/Microsoft
//   표준 로그인 폼이 아니다 (이전 버전이 `input[name="loginfmt"]` 등을 가정했던 것은 틀린
//   추측이었음).
// - 로그인 폼 셀렉터(2026-08-13 실측): 아이디 `input#txtID`, 비밀번호 `input#txtPWD`,
//   로그인 버튼은 `<a class="btn_login" onclick="Login()">` — `<button>`이나
//   `type=submit`이 아니라 JS `Login()` 함수를 호출하는 링크이므로 클릭 후 자체 유효성
//   검증(`checkForm()`)과 비밀번호 클라이언트측 인코딩(`EnCode()`)을 거쳐 폼이 제출된다.
//   따라서 반드시 Playwright로 실제 클릭을 시뮬레이션해야 하며, 원본 비밀번호로 raw HTTP
//   POST를 보내는 방식은 불가능하다.
// - 로그인 실패 시 URL은 그대로 `/PT/login.aspx`에 머무르고, `#divErrorLogin` 요소가
//   보이며 "아이디 또는 비밀번호 오류입니다..." 메시지가 뜬다(실측 확인).
// - cj.cj.net ↔ cjwappr.cj.net 세션 공유 방식: 로그인 성공 시 `.cj.net`(상위 도메인, 예:
//   `cAccess_token`, `ck`, `CJW`, `N_CJW`, `m365_id`) 쿠키가 발급된다. 이후
//   `https://cj.cj.net/NPT/PortalBuilder/23_service.aspx?CONTENTS_ID=EPCT3427` 페이지를 열면
//   그 안의 iframe이 `https://cjwappr.cj.net/NConf/conferenceRoom/reserve_main.aspx`를
//   로드하는데, 이때 `cjwappr.cj.net`이 `/NConf/Anonymity/nconfFilter.aspx`로 302 리다이렉트해
//   `.cj.net` 쿠키를 근거로 SSO 핸드셰이크를 수행하고, `cjwappr.cj.net` 도메인 전용 쿠키
//   `AP`, `NCF`를 새로 발급한다. 이후 ASMX API 호출에는 `.cj.net` 쿠키 + `cjwappr.cj.net`
//   쿠키(`AP`, `NCF`)를 함께 보내야 한다 — cj.cj.net 로그인만으로는 부족하고, 반드시 이
//   iframe 페이지를 한 번 로드해서 cjwappr.cj.net 세션까지 확보해야 한다.
// - 이렇게 얻은 쿠키만 실어서 브라우저 없이 순수 HTTP로 ASMX를 호출해도 정상 동작함을
//   실측 확인했다 (client.ts 참고) — "로그인은 브라우저, API 호출은 가벼운 HTTP 클라이언트"
//   전략이 그대로 유효하다.
//
// 재로그인 전략 (도메인 정의서 9번 "세션이 수 분 단위로 짧게 끊긴다" 관찰 + Vercel
// Serverless Functions 특성): 이 서비스는 함수 인스턴스 간에 세션을 캐싱하지 않는다.
// 요청마다 함수가 새로 시작되므로 캐싱 이점이 크지 않고, 세션이 어차피 수 분 안에
// 끊기므로 "매 요청 시작 시 새로 로그인"이 가장 단순하고 안전한 전략이다.
// getValidSession()이 이 원칙을 그대로 구현한다 — 항상 새 로그인을 수행하므로
// "유효성 확인 후 필요시 재로그인"이 자연스럽게 "매번 재로그인"으로 귀결된다.
//
// 복호화된 CJ 비밀번호는 이 파일 밖으로 절대 리턴되지 않는다 (5-project-principle.md §2).
// 상위 계층은 userId만 넘기고, encryptedPassword 조회 + decryptCorporatePassword 호출은
// 전부 이 파일 안에서 끝난다.

import { chromium as playwrightChromium, type Browser } from "playwright";
import { config } from "../config/env";
import { findUserById } from "../db/repositories/userRepository";
import { decryptCorporatePassword } from "../security/corporatePassword";

const LOGIN_NAV_TIMEOUT_MS = 30_000;

// 로그인 성공 후 cjwappr.cj.net 세션까지 확보하기 위해 여는 회의실 예약 페이지.
// (사용자 제공 경로 — 이 안의 iframe이 cjwappr.cj.net/NConf/conferenceRoom/reserve_main.aspx를
// 로드하면서 nconfFilter.aspx SSO 핸드셰이크가 일어난다.)
const MEETING_ROOM_PAGE_PATH = "/NPT/PortalBuilder/23_service.aspx?CONTENTS_ID=EPCT3427";

// cjwappr.cj.net API 호출에 필요한 쿠키만 골라낸다: cjwappr.cj.net 전용 쿠키(AP, NCF 등)와
// 여러 cj.net 서브도메인이 공유하는 상위 도메인 쿠키(.cj.net, 예: cAccess_token, CJW).
// cj.cj.net 전용 쿠키(LIMITED, EP, ROLE_LIST 등)는 cjwappr.cj.net 호출에 불필요하므로 제외한다.
function isRelevantCookieForCjwappr(domain: string): boolean {
  return domain === "cjwappr.cj.net" || domain === ".cj.net";
}

/** CJ 자동화 계층 상위(client.ts)에 전달되는 세션 정보. 쿠키만 담고 있고 비밀번호는 없다. */
export interface CjSession {
  cookieHeader: string;
  baseUrl: string;
}

function isServerlessEnv(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Vercel Functions(@sparticuz/chromium)와 로컬 개발(일반 Playwright 로컬 Chromium)을
 * 환경에 따라 자동으로 분기한다. 로컬에서는 `npx playwright install chromium`으로 설치된
 * 브라우저를 그대로 쓴다.
 */
async function launchBrowser(): Promise<Browser> {
  if (isServerlessEnv()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return playwrightChromium.launch({ headless: true });
}

export class CjLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CjLoginError";
  }
}

/**
 * emailAlias/평문 비밀번호로 직접 로그인해 세션을 확보한다. `loginAndGetSession`(DB 조회 +
 * 복호화)과 일회성 스크립트(예: 회의실 마스터데이터 스캔) 양쪽에서 공통으로 쓰기 위해
 * 분리했다 — 이 함수 자체는 자격증명을 어디서 가져왔는지 모른다(DB든 임시 스크립트든).
 * 호출자는 평문 비밀번호를 로그/파일에 남기지 않을 책임을 진다.
 *
 * 로그인 흐름 (2026-08-13 실사용 검증 완료, 파일 상단 주석 참고):
 * 1. cj.cj.net(사내 포털)의 자체 로그인 폼(#txtID/#txtPWD/.btn_login)으로 로그인
 * 2. 회의실 예약 페이지(23_service.aspx)를 열어 iframe이 cjwappr.cj.net 세션(AP/NCF 쿠키)을
 *    확보하도록 함
 * 3. cjwappr.cj.net 호출에 필요한 쿠키만 추출해 반환 — 이후 API 호출은 브라우저 없이
 *    가벼운 HTTP 클라이언트(client.ts)로 수행
 */
export async function loginWithCredentials(
  emailAlias: string,
  corporatePassword: string
): Promise<CjSession> {
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(LOGIN_NAV_TIMEOUT_MS);

    // 1. cj.cj.net 자체 로그인 폼 (Azure AD 아님 — 실측 확인)
    await page.goto(config.cjPortalBaseUrl, { waitUntil: "domcontentloaded" });

    await page.fill("input#txtID", emailAlias);
    await page.fill("input#txtPWD", corporatePassword);

    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: LOGIN_NAV_TIMEOUT_MS })
        .catch(() => {
          // 로그인 실패 시 URL이 안 바뀌고 그대로 login.aspx에 머무는 경우가 있어
          // 여기서 발생하는 타임아웃은 무시하고, 아래에서 명시적으로 실패 여부를 판정한다.
        }),
      page.click(".btn_login"),
    ]);

    // 로그인 실패 판정: 실패 시 URL이 그대로 /PT/login.aspx이고 #divErrorLogin이 노출됨(실측 확인)
    const loginErrorVisible = await page
      .locator("#divErrorLogin")
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (loginErrorVisible) {
      const errorText = await page.locator("#divErrorLogin").innerText().catch(() => "");
      throw new CjLoginError(
        `[cj-automation/session] CJ 사내 계정 로그인에 실패했습니다: ${errorText || "(오류 메시지 없음)"}`
      );
    }

    // 2. 회의실 예약 페이지를 열어 cjwappr.cj.net 세션(AP/NCF 쿠키)까지 확보한다.
    //    (이 페이지 안의 iframe이 nconfFilter.aspx SSO 핸드셰이크를 트리거함 — 파일 상단 주석 참고)
    const meetingRoomPageUrl = new URL(MEETING_ROOM_PAGE_PATH, config.cjPortalBaseUrl).toString();
    await page
      .goto(meetingRoomPageUrl, { waitUntil: "networkidle", timeout: LOGIN_NAV_TIMEOUT_MS })
      .catch(() => {
        // networkidle 타임아웃은 흔히 발생할 수 있으므로(광고 배너 등 지속적 폴링), 아래에서
        // cjwappr.cj.net 쿠키가 실제로 확보됐는지로 성공 여부를 판정한다.
      });

    // iframe의 SSO 핸드셰이크(nconfFilter.aspx)가 networkidle 판정 이후에도 비동기로 조금 더
    // 걸릴 수 있음을 실측으로 확인 — 쿠키 확인 전에 짧게 여유를 둔다.
    await page.waitForTimeout(5_000);

    const cookies = await context.cookies();
    const cjwapprCookies = cookies.filter((cookie) => isRelevantCookieForCjwappr(cookie.domain));

    const hasCjwapprAuthCookie = cjwapprCookies.some((cookie) => cookie.domain === "cjwappr.cj.net");
    if (!hasCjwapprAuthCookie) {
      throw new CjLoginError(
        "[cj-automation/session] cj.cj.net 로그인은 성공했지만 cjwappr.cj.net(예약 API) 세션 쿠키를 확보하지 못했습니다."
      );
    }

    const cookieHeader = cjwapprCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    return { cookieHeader, baseUrl: config.cjBaseUrl };
  } finally {
    await browser.close();
  }
}

/**
 * userId로 DB에서 encryptedPassword를 조회하고, 그 자리에서 복호화해 즉시
 * `loginWithCredentials`에 넘긴다. 복호화된 비밀번호는 이 함수 밖으로 리턴되지 않는다.
 */
export async function loginAndGetSession(userId: string): Promise<CjSession> {
  const user = await findUserById(userId);
  if (!user) {
    throw new CjLoginError("[cj-automation/session] 사용자를 찾을 수 없습니다.");
  }

  const corporatePassword = decryptCorporatePassword(user.encryptedPassword);
  return loginWithCredentials(user.emailAlias, corporatePassword);
}

/**
 * 도구 계층의 유일한 진입점. "세션 캐싱하지 않고 매 요청마다 로그인부터 시작"
 * 전략을 그대로 구현한다 — 상위 계층은 세션 상태를 알거나 관리하지 않는다.
 */
export async function getValidSession(userId: string): Promise<CjSession> {
  return loginAndGetSession(userId);
}
