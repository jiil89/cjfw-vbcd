import { getAccessToken, useAuthStore } from "../stores/authStore";
import type { ApiErrorBody, RefreshResponse } from "../types/user";

// 백엔드 라우트가 /auth, /admin, /chat로 루트 마운트되어 있으므로(backend/src/app.ts),
// 여기서도 그 경로를 그대로 쓴다. Dev에서는 vite.config.ts의 server.proxy가 이 경로들을
// http://localhost:3000으로 넘겨준다. Prd에서는 same-origin 배포를 전제로 상대 경로 그대로 둔다.
const REFRESH_PATH = "/auth/refresh";
const LOGIN_PATH = "/auth/login";

export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

// 동시에 여러 요청이 401을 받아도 /auth/refresh는 한 번만 호출되도록 in-flight 프로미스를 공유한다.
let refreshInFlight: Promise<string> | null = null;

async function requestAccessTokenRefresh(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      // Refresh Token은 httpOnly 쿠키에만 있으므로 JS는 이 쿠키를 직접 읽지 않는다 —
      // credentials: 'include'로 브라우저가 자동으로 실어 보낸다.
      const res = await fetch(REFRESH_PATH, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        useAuthStore.getState().clearSession();
        throw new HttpError(res.status, "세션이 만료되었습니다. 다시 로그인해주세요.", "SESSION_EXPIRED");
      }

      const data = (await res.json()) as RefreshResponse;
      useAuthStore.getState().setAccessToken(data.access_token);
      return data.access_token;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

function buildHeaders(options: RequestInit, skipAuthHeader: boolean): Headers {
  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuthHeader) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return headers;
}

/**
 * fetch 래퍼 — Access Token을 Zustand(authStore)에서 읽어 Authorization 헤더에 첨부하고,
 * 401 응답을 받으면 POST /auth/refresh로 재발급을 시도한 뒤 원 요청을 1회만 재시도한다.
 * /auth/login, /auth/refresh 자체는 재시도 대상에서 제외한다(무한 루프 방지).
 */
export async function httpClient<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const isAuthBootstrapEndpoint = path === REFRESH_PATH || path === LOGIN_PATH;

  const performFetch = () =>
    fetch(path, {
      ...options,
      headers: buildHeaders(options, isAuthBootstrapEndpoint),
      credentials: "include",
    });

  let res = await performFetch();

  if (res.status === 401 && !isAuthBootstrapEndpoint) {
    try {
      await requestAccessTokenRefresh();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, "세션이 만료되었습니다. 다시 로그인해주세요.", "SESSION_EXPIRED");
    }
    res = await performFetch();
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // 응답 바디가 JSON이 아닌 경우(네트워크 오류 페이지 등) — 기본 메시지로 대체
    }
    throw new HttpError(
      res.status,
      body?.error?.message ?? "요청 처리 중 오류가 발생했습니다.",
      body?.error?.code
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
