import { Schema } from "effect";
import { Properties } from "./properties.js";
import { QueryCondition } from "./query.js";

export const ShareScope = Schema.Literal("read", "write");
export type ShareScope = typeof ShareScope.Type;

// The slice of a resolved share grant the engine needs to enforce access. Built
// by the auth layer at token-resolution time and carried on the Principal, so
// the engine never re-queries the grant row. `limits` are the raw quota values
// (null = unlimited); the engine reads current usage separately.
export const ShareGrantContext = Schema.Struct({
  grantId: Schema.NonEmptyString,
  identityId: Schema.optional(Schema.String),
  conditions: Schema.Array(QueryCondition),
  writeStamp: Schema.optional(Properties),
  allowOwnDelete: Schema.Boolean,
  limits: Schema.optional(
    Schema.Struct({
      maxItemBytes: Schema.NullOr(Schema.Number),
      maxTotalBytes: Schema.NullOr(Schema.Number),
      maxItems: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type ShareGrantContext = typeof ShareGrantContext.Type;
