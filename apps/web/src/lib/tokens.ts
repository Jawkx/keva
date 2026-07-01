import type { MintToken, MintTokenResult, TokenRecord } from "@keva/schema";
import { sessionApiRequest } from "./session-api";

export const listTokens = (): Promise<readonly TokenRecord[]> =>
  sessionApiRequest<readonly TokenRecord[]>("GET", "/api/tokens");

export const mintToken = (input: MintToken): Promise<MintTokenResult> =>
  sessionApiRequest<MintTokenResult>("POST", "/api/tokens", input);

export const revokeToken = (id: string): Promise<{ revoked: boolean }> =>
  sessionApiRequest<{ revoked: boolean }>("DELETE", `/api/tokens/${encodeURIComponent(id)}`);
