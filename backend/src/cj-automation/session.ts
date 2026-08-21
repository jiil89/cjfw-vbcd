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
// - 로그인 성공 시 URL은 즉시 바뀌지 않고(클릭 직후에도 `/PT/login.aspx`), 내부적으로
//   `https://cj.cj.net/NPT/PortalBuilder/23_main.aspx`(포털 메인 대시보드)로 이동한다 —
//   `page.waitForURL("**/23_main.aspx**")`로 대기해야 한다.
// - **`23_service.aspx?CONTENTS_ID=EPCT3427`로 직접 `page.goto`하면 `net::ERR_ABORTED`로
//   실패한다(2026-08-13 재검증)** — 이 URL은 실제 서버 페이지가 아니라, 포털 메인
//   대시보드(`23_main.aspx`) 안의 JS 함수 `select_menu('EPCT3427','LSB')`가 클라이언트
//   사이드에서 콘텐츠를 스왑하는 방식이다. 따라서 반드시 `23_main.aspx`를 로드한 뒤 그
//   안의 회의실예약 버튼(`button#bntConf`, `onclick="select_menu('EPCT3427','LSB')"`)을
//   실제로 클릭해야 한다.
// - `#bntConf` 클릭 시 `cjwappr.cj.net`으로의 SSO 핸드셰이크가 즉시(1초 내) 일어나
//   `cjwappr.cj.net` 도메인 쿠키 `AP`(그리고 있으면 `NCF`)가 발급됨을 실측 확인했다.
//   과거 버전은 직접 URL 이동 후 고정 5초 대기로 판정했는데, 이는 URL 이동 자체가
//   ERR_ABORTED로 실패하면서 우연히 다른 위젯(결재함 등)의 SSO가 걸려 간헐적으로만
//   통과하던 것이었다 — 안정적인 방법이 아니었음.
// - cj.cj.net ↔ cjwappr.cj.net 세션 공유 방식: 로그인 성공 시 `.cj.net`(상위 도메인, 예:
//   `cAccess_token`, `ck`, `CJW`, `N_CJW`, `m365_id`) 쿠키가 발급된다. 이후 위 방식대로
//   회의실예약 버튼을 클릭하면 `cjwappr.cj.net`이 `/NConf/Anonymity/nconfFilter.aspx`로
//   리다이렉트해 `.cj.net` 쿠키를 근거로 SSO 핸드셰이크를 수행하고, `cjwappr.cj.net`
//   도메인 전용 쿠키 `AP`를 새로 발급한다. 이후 ASMX API 호출에는 `.cj.net` 쿠키 +
//   `cjwappr.cj.net` 쿠키(`AP`)를 함께 보내야 한다.
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

import { chromium as playwrightChromium, type Browser, type Page } from "playwright";
import { config } from "../config/env";
import { findUserById } from "../db/repositories/userRepository";
import { decryptCorporatePassword } from "../security/corporatePassword";
import { getCachedCjSession, setCachedCjSession } from "./sessionCache";
import { toKstDate } from "../lib/kst";

const LOGIN_NAV_TIMEOUT_MS = 30_000;

// [2026-08-14 실사용 검증 완료 — SaveReserve Result:0 미해결 이슈의 진짜 원인]
// cjwappr.cj.net의 예약 관련 ASMX들(getEmptyRoomInfo/checkRoom/SaveReserve 등)은 쿠키만으로는
// 신청자 신원을 못 찾는 레거시 ASP.NET WebForms 서버측 Session 상태에 의존한다 — 로그인 직후
// #bntConf 클릭만으로는 이 Session이 채워지지 않고, 실제 예약 폼 페이지(reserve_insmod.aspx)를
// 한 번이라도 방문해야(Page_Load에서 채워지는 것으로 추정) 이후 호출들이 신청자 본인 정보를
// 정상적으로 찾는다. 방문 전에는 getEmptyRoomInfo의 Table2(본인 연락처)/Table3(승인자 목록)이
// 계속 빈 배열로 오고, 그 상태에서 SaveReserve를 호출하면 항상 `{"Result":0,"Seq":null}`로
// 거부된다 — 필드값 문제가 아니라 이 세션 워밍업 단계가 통째로 빠져 있었던 것.
// 실사용 검증: 로그인 직후 이 워밍업 없이 SaveReserve → 항상 Result:0. 워밍업 한 번(회의실을
// 특정하지 않아도 무방 — room_code를 비워도 동일하게 작동함을 확인) 후에는 같은 세션으로
// 여러 회의실(3F-4, 3F-9 등)의 SaveReserve가 전부 Result:1(성공)로 정상 동작함을 확인했다.
// area_code/sub_area_code는 이 프로젝트가 지원하는 유일한 사업장·층 조합(상암S시티 예시로
// 도메인 정의서 8번/9번에 이미 등장하는 상수, 6번 "1차 범위는 상암S시티 고정")을 그대로 쓴다 —
// 이 워밍업은 실제 예약 대상 회의실과 무관하며 세션 상태만 채우는 용도라 특정 회의실코드가
// 필요 없다. [20260821] 실제 코드값이라 config(CJ_SITE_AREA_CODE/CJ_SITE_SUB_AREA_CODE)로 뺐다.

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

/** ESM 전용 패키지를 CommonJS 빌드에서 불러오기 위한 진짜 동적 import.
 *
 * [2026-08-19 Vercel 첫 배포에서 발견] `await import("@sparticuz/chromium")`을 그냥 쓰면,
 * tsconfig가 `"module": "CommonJS"`라 TypeScript가 이걸 `require()`로 낮춰서 컴파일한다.
 * 그런데 @sparticuz/chromium은 `"type": "module"`인 순수 ESM 패키지(CJS 빌드 없음)라
 * 런타임에 `ERR_REQUIRE_ESM`으로 죽는다 — 로컬은 이 분기를 안 타서 여태 드러나지 않았고,
 * 배포 후 로그인(=CJ 세션 예열)이 전부 401로 실패해서야 드러났다.
 *
 * `new Function`으로 감싸면 TypeScript가 그 안의 import를 정적으로 보지 못해 변환하지
 * 않으므로, Node가 실행 시점에 ESM으로 제대로 로드한다. tsconfig 전체를 Node16으로 바꾸는
 * 방법도 있지만, 백엔드 전체의 모듈 해석이 바뀌어 영향 범위가 훨씬 커서 이 한 지점만 막는다.
 */
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{ default: { args: string[]; executablePath: () => Promise<string> } }>;

/**
 * Vercel Functions(@sparticuz/chromium)와 로컬 개발(일반 Playwright 로컬 Chromium)을
 * 환경에 따라 자동으로 분기한다. 로컬에서는 `npx playwright install chromium`으로 설치된
 * 브라우저를 그대로 쓴다.
 */
async function launchBrowser(): Promise<Browser> {
  if (isServerlessEnv()) {
    const chromium = (await importEsm("@sparticuz/chromium")).default;
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return playwrightChromium.launch({ headless: true });
}

const WARMUP_NAV_TIMEOUT_MS = 15_000;

/**
 * reserve_insmod.aspx를 한 번 방문해 서버측 예약 세션 상태를 채운다(파일 상단 주석 참고).
 * `#bntConf` 클릭 이후 `reserve_main.aspx`가 별도 논리 페이지(Playwright 기준)로 뜨는 경우가
 * 있어 `context.pages()`에서 그 프레임을 다시 찾는다. 이 단계가 실패해도(타임아웃 등) 로그인
 * 자체를 막지는 않는다 — 실패하면 이후 SaveReserve가 그때 가서 Result:0으로 알려준다.
 */
async function warmUpReservationSession(page: Page): Promise<void> {
  try {
    const context = page.context();

    // #bntConf 클릭 직후에는 reserve_main.aspx 프레임이 아직 안 뜬 상태일 수 있어(쿠키
    // 폴링은 AP 쿠키가 잡히는 즉시 끝나므로 반드시 화면 렌더링까지 기다려주진 않는다),
    // 프레임이 나타날 때까지 잠깐 폴링한다.
    const FRAME_POLL_INTERVAL_MS = 500;
    const FRAME_POLL_MAX_ATTEMPTS = 10;
    let hostPage = context.pages().find((p) => p.url().includes("23_service.aspx")) ?? page;
    let reserveFrame = hostPage.frames().find((frame) => frame.url().includes("reserve_main.aspx"));
    for (let attempt = 0; !reserveFrame && attempt < FRAME_POLL_MAX_ATTEMPTS; attempt += 1) {
      await page.waitForTimeout(FRAME_POLL_INTERVAL_MS);
      hostPage = context.pages().find((p) => p.url().includes("23_service.aspx")) ?? page;
      reserveFrame = hostPage.frames().find((frame) => frame.url().includes("reserve_main.aspx"));
    }
    if (!reserveFrame) {
      console.error("[cj-automation/session] 예약 세션 워밍업 실패: reserve_main.aspx 프레임을 찾지 못함");
      return;
    }

    // [버그 수정, 20260818] CJ는 한국 시스템이라 UTC 날짜를 넘기면 자정~오전 9시 사이엔
    // 어제 날짜로 워밍업하게 된다. KST로 계산한다.
    const today = toKstDate(new Date());
    const warmupUrl =
      `${config.cjBaseUrl}/NConf/conferenceRoom/reserve_insmod.aspx` +
      `?area_code=${config.cjSiteAreaCode}&sub_area_code=${config.cjSiteSubAreaCode}` +
      `&reserve_date=${today}&room_code=&start_time=&end_time=&time_count=1&adminyn=N`;

    await reserveFrame.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: WARMUP_NAV_TIMEOUT_MS });
    await hostPage.waitForTimeout(1_500);
  } catch (error) {
    console.error("[cj-automation/session] 예약 세션 워밍업 중 오류(무시하고 진행)", error);
  }
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
 * 2. 포털 메인 대시보드(23_main.aspx) 로딩을 기다린 뒤 회의실예약 버튼(#bntConf)을 클릭해
 *    cjwappr.cj.net 세션(AP 쿠키)을 확보함
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
        `[cj-automation/session] CJ WORLD 계정 로그인에 실패했습니다: ${errorText || "(오류 메시지 없음)"}`
      );
    }

    // 2. 포털 메인 대시보드(23_main.aspx)로 이동을 기다린 뒤, 회의실예약 버튼(#bntConf)을
    //    실제로 클릭한다 — CONTENTS_ID=EPCT3427 URL로 직접 page.goto하면 net::ERR_ABORTED로
    //    실패한다(파일 상단 주석 참고). 이 버튼 클릭이 cjwappr.cj.net SSO 핸드셰이크를 트리거한다.
    await page.waitForURL("**/23_main.aspx**", { timeout: LOGIN_NAV_TIMEOUT_MS });
    await page.click("#bntConf");

    // 클릭 직후(실측: 1초 내) cjwappr.cj.net의 AP 쿠키가 발급된다. 사내망 지연을 감안해
    // 최대 20초간 1초 간격으로 폴링한다 — 쿠키가 빨리 잡히면 그만큼 빨리 반환된다.
    const COOKIE_POLL_INTERVAL_MS = 1_000;
    const COOKIE_POLL_MAX_ATTEMPTS = 20;

    let cjwapprCookies: Awaited<ReturnType<typeof context.cookies>> = [];
    let hasCjwapprAuthCookie = false;
    for (let attempt = 0; attempt < COOKIE_POLL_MAX_ATTEMPTS; attempt += 1) {
      const cookies = await context.cookies();
      cjwapprCookies = cookies.filter((cookie) => isRelevantCookieForCjwappr(cookie.domain));
      hasCjwapprAuthCookie = cjwapprCookies.some((cookie) => cookie.domain === "cjwappr.cj.net" && cookie.name === "AP");
      if (hasCjwapprAuthCookie) break;
      await page.waitForTimeout(COOKIE_POLL_INTERVAL_MS);
    }

    if (!hasCjwapprAuthCookie) {
      throw new CjLoginError(
        "[cj-automation/session] cj.cj.net 로그인은 성공했지만 cjwappr.cj.net(예약 API) 세션 쿠키를 확보하지 못했습니다."
      );
    }

    // 3. 예약 ASMX들이 의존하는 서버측 Session을 채우기 위해 reserve_insmod.aspx를 한 번
    //    방문한다(파일 상단 주석 참고). 이 페이지는 파라미터가 없거나 이상해도 보통
    //    ErrorPage.aspx로 리다이렉트되지만, 방문 자체가 목적이므로 실패해도 무시한다.
    await warmUpReservationSession(page);

    const cookiesAfterWarmup = await context.cookies();
    const finalCookies = cookiesAfterWarmup.filter((cookie) => isRelevantCookieForCjwappr(cookie.domain));
    const cookieHeader = finalCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

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
 * 도구 계층의 유일한 진입점.
 *
 * [2026-08-14 변경, 사용자 요청] 원래는 "세션 캐싱하지 않고 매 요청마다 로그인부터 시작"
 * 전략이었으나(각 요청이 몇~수십 초씩 CJ 로그인 지연을 그대로 겪는 문제), 이 앱
 * 로그인(JWT) 시점에 미리 확보해둔 CJ 세션을 짧은 TTL(`sessionCache.ts`) 동안 재사용하는
 * 방식으로 바꿨다. 캐시에 유효한 세션이 있으면 그대로 반환하고, 없거나 만료됐으면 새로
 * 로그인한 뒤 캐시에 저장한다.
 */
export async function getValidSession(userId: string): Promise<CjSession> {
  const cached = getCachedCjSession(userId);
  if (cached) return cached;

  const session = await loginAndGetSession(userId);
  setCachedCjSession(userId, session);
  return session;
}
