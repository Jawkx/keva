import type { MintToken, MintTokenResult, TokenRecord } from "@keva/schema";

// Tokens have no SDK method, so we call the API directly. These endpoints
// require an admin session, which the logged-in user already has, so we just
// send cookies (credentials: "include") same-origin via the Vite proxy. Paths
// are under /api to match the rest of the API surface.

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    // Surface the server's typed error so errorMessage() / isUnauthorized()
    // can handle it just like SDK errors do.
    if (typeof payload === "object" && payload !== null && "_tag" in payload) {
      throw payload;
    }
    throw new Error(`Request to ${path} failed with ${response.status}`);
  }
  return payload as T;
};

export const listTokens = (): Promise<readonly TokenRecord[]> =>
  request<readonly TokenRecord[]>("GET", "/api/tokens");

export const mintToken = (input: MintToken): Promise<MintTokenResult> =>
  request<MintTokenResult>("POST", "/api/tokens", input);

export const revokeToken = (id: string): Promise<{ revoked: boolean }> =>
  request<{ revoked: boolean }>("DELETE", `/api/tokens/${encodeURIComponent(id)}`);
