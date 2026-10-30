import { Schema } from "effect";
import { IsoInstant, Scope } from "./common.js";

export const TokenRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type TokenRecord = typeof TokenRecord.Type;

export const MintToken = Schema.Struct({
  name: Schema.NonEmptyString,
  scopes: Schema.Array(Scope).pipe(Schema.check(Schema.isMinLength(1))),
  expiresAt: Schema.optional(IsoInstant),
});
export type MintToken = typeof MintToken.Type;

export const MintTokenResult = Schema.Struct({
  token: Schema.String,
  record: TokenRecord,
});
export type MintTokenResult = typeof MintTokenResult.Type;
