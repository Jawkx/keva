import { Schema } from "effect";
import { ItemId } from "./common.js";
import { KevaItem } from "./item.js";
import { Properties, PropertyValue } from "./properties.js";

export const BatchDelete = Schema.Struct({
  ids: Schema.Array(ItemId).pipe(Schema.minItems(1), Schema.maxItems(1000)),
});
export type BatchDelete = typeof BatchDelete.Type;

export const BatchDeleteResult = Schema.Struct({
  deleted: Schema.Array(Schema.String),
  failed: Schema.Array(Schema.Struct({ id: Schema.String, error: Schema.String })),
});
export type BatchDeleteResult = typeof BatchDeleteResult.Type;

export const InitiateUpload = Schema.Struct({
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  size: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  source: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => "upload",
  }),
  properties: Schema.optionalWith(Properties, { default: () => ({}) }),
  retryKey: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))),
});
export type InitiateUpload = typeof InitiateUpload.Type;

export const InitiateUploadResult = Schema.Struct({
  item: KevaItem,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type InitiateUploadResult = typeof InitiateUploadResult.Type;

// A patch over the unified key-space: `set`/`unset` may name user-writable
// fields (e.g. "name") or user properties interchangeably. The wire schema is
// deliberately permissive about keys — `routePatch` (see fields.ts) is the
// authority that routes each key to its column or the property blob and rejects
// writes to system-owned or reserved keys.
export const ItemPatch = Schema.Struct({
  expectedRevision: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  ),
  set: Schema.optionalWith(Schema.Record({ key: Schema.String, value: PropertyValue }), {
    default: () => ({}),
  }),
  unset: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
export type ItemPatch = typeof ItemPatch.Type;

export const BatchPatchItem = Schema.Struct({
  id: ItemId,
  expectedRevision: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  ),
});
export type BatchPatchItem = typeof BatchPatchItem.Type;

export const BatchPatch = Schema.Struct({
  items: Schema.Array(BatchPatchItem).pipe(
    Schema.minItems(1),
    Schema.maxItems(1000),
    Schema.filter((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: () => "Item ids must be unique",
    }),
  ),
  set: ItemPatch.fields.set,
  unset: ItemPatch.fields.unset,
}).pipe(
  Schema.filter((batch) => Object.keys(batch.set).length > 0 || batch.unset.length > 0, {
    message: () => "At least one field must be set or unset",
  }),
);
export type BatchPatch = typeof BatchPatch.Type;

export const DownloadResult = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
});
export type DownloadResult = typeof DownloadResult.Type;
