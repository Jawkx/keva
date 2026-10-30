import { Effect, Schema } from "effect";
import { ItemId } from "./common.js";
import { KevaItem } from "./item.js";
import { Properties, PropertyValue } from "./properties.js";
import { ItemPresentation } from "./presentation.js";

export const BatchDelete = Schema.Struct({
  ids: Schema.Array(ItemId).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1000)),
  ),
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
  size: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  source: Schema.NonEmptyString.pipe(Schema.withDecodingDefaultType(Effect.succeed("upload"))),
  properties: Properties.pipe(Schema.withDecodingDefaultType(Effect.succeed({}))),
  retryKey: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(200))),
  ),
});
export type InitiateUpload = typeof InitiateUpload.Type;

export const InitiateUploadResult = Schema.Struct({
  item: KevaItem,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
});
export type InitiateUploadResult = typeof InitiateUploadResult.Type;

export const ThumbnailContentType = Schema.Literals([
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/avif",
]);
export type ThumbnailContentType = typeof ThumbnailContentType.Type;

export const ThumbnailUploadInput = Schema.Struct({
  contentType: ThumbnailContentType,
  size: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 1024 * 1024 })),
  ),
});
export type ThumbnailUploadInput = typeof ThumbnailUploadInput.Type;

export const ThumbnailUploadResult = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
});
export type ThumbnailUploadResult = typeof ThumbnailUploadResult.Type;

// A patch over the unified key-space: `set`/`unset` may name user-writable
// fields (e.g. "name") or user properties interchangeably. The wire schema is
// deliberately permissive about keys — `routePatch` (see fields.ts) is the
// authority that routes each key to its column or the property blob and rejects
// writes to system-owned or reserved keys.
export const ItemPatch = Schema.Struct({
  expectedRevision: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
    ),
  ),
  set: Schema.Record(Schema.String, PropertyValue).pipe(
    Schema.withDecodingDefaultType(Effect.succeed({})),
  ),
  unset: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultType(Effect.succeed([]))),
  presentation: Schema.optional(ItemPresentation),
});
export type ItemPatch = typeof ItemPatch.Type;

export const BatchPatchItem = Schema.Struct({
  id: ItemId,
  expectedRevision: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
    ),
  ),
});
export type BatchPatchItem = typeof BatchPatchItem.Type;

export const BatchPatch = Schema.Struct({
  items: Schema.Array(BatchPatchItem).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1000)),
    Schema.check(
      Schema.makeFilter((items) => new Set(items.map((item) => item.id)).size === items.length, {
        message: "Item ids must be unique",
      }),
    ),
  ),
  set: ItemPatch.fields.set,
  unset: ItemPatch.fields.unset,
}).pipe(
  Schema.check(
    Schema.makeFilter((batch) => Object.keys(batch.set).length > 0 || batch.unset.length > 0, {
      message: "At least one field must be set or unset",
    }),
  ),
);
export type BatchPatch = typeof BatchPatch.Type;

export const DownloadResult = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
});
export type DownloadResult = typeof DownloadResult.Type;
