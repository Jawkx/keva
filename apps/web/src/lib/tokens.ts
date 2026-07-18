import { Schema } from "effect";
import {
  MintTokenResult,
  TokenRecord,
  type MintToken,
  type MintTokenResult as MintTokenResultType,
  type TokenRecord as TokenRecordType,
} from "@keva/schema";
import { sessionApiRequest } from "./session-api";

const Revoked = Schema.Struct({ revoked: Schema.Boolean });

export const listTokens = (): Promise<readonly TokenRecordType[]> =>
  sessionApiRequest("GET", "/api/tokens", Schema.Array(TokenRecord));

export const mintToken = (input: MintToken): Promise<MintTokenResultType> =>
  sessionApiRequest("POST", "/api/tokens", MintTokenResult, input);

export const revokeToken = (id: string): Promise<{ revoked: boolean }> =>
  sessionApiRequest("DELETE", `/api/tokens/${encodeURIComponent(id)}`, Revoked);
