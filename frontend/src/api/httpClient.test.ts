import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpClient, HttpError } from "./httpClient";
import { useAuthStore } from "../stores/authStore";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("httpClient", () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
    vi.restoreAllMocks();
  });

  it("Authorization 헤더에 accessToken을 첨부한다", async () => {
    useAuthStore.getState().setSession("token-abc", {
      id: "u1",
      email_alias: "test",
      is_admin: false,
      status: "approved",
      approved_at: null,
      created_at: "2026-01-01",
    });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await httpClient("/chat/messages", { method: "POST", body: JSON.stringify({}) });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-abc");
  });

  it("401을 받으면 /auth/refresh를 호출해 새 토큰을 받고 원 요청을 1회 재시도한다", async () => {
    useAuthStore.getState().setSession("expired-token", {
      id: "u1",
      email_alias: "test",
      is_admin: false,
      status: "approved",
      approved_at: null,
      created_at: "2026-01-01",
    });

    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "만료" } })) // 1st original call
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "new-token", token_type: "Bearer", expires_in: 900 })
      ) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { data: "ok" })); // retried original call

    vi.stubGlobal("fetch", fetchMock);

    const result = await httpClient<{ data: string }>("/chat/messages");

    expect(result).toEqual({ data: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/auth/refresh");
    expect(useAuthStore.getState().accessToken).toBe("new-token");

    const retryHeaders = fetchMock.mock.calls[2][1].headers as Headers;
    expect(retryHeaders.get("Authorization")).toBe("Bearer new-token");
  });

  it("refresh마저 실패하면 세션을 비우고 HttpError를 던진다", async () => {
    useAuthStore.getState().setSession("expired-token", {
      id: "u1",
      email_alias: "test",
      is_admin: false,
      status: "approved",
      approved_at: null,
      created_at: "2026-01-01",
    });

    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "만료" } }))
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "REFRESH_TOKEN_INVALID", message: "재발급 불가" } })
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(httpClient("/chat/messages")).rejects.toBeInstanceOf(HttpError);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("동시에 여러 요청이 401을 받아도 /auth/refresh는 한 번만 호출된다", async () => {
    useAuthStore.getState().setSession("expired-token", {
      id: "u1",
      email_alias: "test",
      is_admin: false,
      status: "approved",
      approved_at: null,
      created_at: "2026-01-01",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/auth/refresh") {
        return jsonResponse(200, { access_token: "new-token", token_type: "Bearer", expires_in: 900 });
      }
      return jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "만료" } });
    });

    // 재시도(refresh 이후)에는 200을 주도록 별도 카운터로 제어
    let chatCallCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/auth/refresh") {
        return jsonResponse(200, { access_token: "new-token", token_type: "Bearer", expires_in: 900 });
      }
      chatCallCount += 1;
      if (chatCallCount <= 2) {
        return jsonResponse(401, { error: { code: "TOKEN_EXPIRED", message: "만료" } });
      }
      return jsonResponse(200, { data: "ok" });
    });

    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([httpClient("/chat/messages"), httpClient("/chat/messages")]);

    const refreshCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      return url === "/auth/refresh";
    });
    expect(refreshCalls).toHaveLength(1);
  });
});
