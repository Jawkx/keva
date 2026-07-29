import { Schema } from "effect";
import { ItemId, ItemStatus } from "./common.js";
import { Properties } from "./properties.js";

export const KevaItem = Schema.Struct({
  id: ItemId,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  declaredSize: Schema.Number,
  size: Schema.NullOr(Schema.Number),
  etag: Schema.NullOr(Schema.String),
  source: Schema.NonEmptyString,
  status: ItemStatus,
  storageKey: Schema.NonEmptyString,
  stagingKey: Schema.NonEmptyString,
  revision: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deletedAt: Schema.optional(Schema.String),
  properties: Properties,
});
export type KevaItem = typeof KevaItem.Type;
