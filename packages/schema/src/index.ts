import { Schema } from "effect";
import { isPropertyKey, isQueryKey, PROPERTY_LIMITS } from "./fields.js";

export * from "./fields.js";

const encodedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const ITEM_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const PropertyKey = Schema.String.pipe(
  Schema.maxLength(PROPERTY_LIMITS.keyLength),
  Schema.filter((key) => isPropertyKey(key), {
    message: () => "Property keys must be valid and non-reserved",
  }),
);
export type PropertyKey = typeof PropertyKey.Type;

export const PropertyString = Schema.String.pipe(
  Schema.filter(
    (value) =>
      new TextEncoder().encode(value).byteLength <= PROPERTY_LIMITS.stringBytes,
    { message: () => "String properties must be at most 8 KB" },
  ),
);

const PropertyArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Array(item).pipe(Schema.maxItems(PROPERTY_LIMITS.arrayItems));

export const PropertyValue = Schema.Union(
  PropertyString,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  PropertyArray(PropertyString),
  PropertyArray(Schema.Number),
  PropertyArray(Schema.Boolean),
);
export type PropertyValue = typeof PropertyValue.Type;

export const Properties = Schema.Record({
  key: Schema.String,
  value: PropertyValue,
}).pipe(
  Schema.filter(
    (properties) => Object.keys(properties).every(isPropertyKey),
    { message: () => "Invalid or reserved property key" },
  ),
  Schema.filter(
    (properties) => Object.keys(properties).length <= PROPERTY_LIMITS.keys,
    { message: () => "An item may have at most 256 properties" },
  ),
  Schema.filter(
    (properties) => encodedBytes(properties) <= PROPERTY_LIMITS.totalBytes,
    { message: () => "Properties must be at most 64 KB in total" },
  ),
);
export type Properties = typeof Properties.Type;

export const Scope = Schema.Literal("read", "write", "delete", "admin");
export type Scope = typeof Scope.Type;

export const Principal = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  via: Schema.Literal("session", "token"),
});
export type Principal = typeof Principal.Type;

export const ItemStatus = Schema.Literal("pending", "ready", "deleting");
export type ItemStatus = typeof ItemStatus.Type;

export const ItemId = Schema.String.pipe(Schema.pattern(ITEM_ID_PATTERN));
export type ItemId = typeof ItemId.Type;

export const KevaItem = Schema.Struct({
  id: ItemId,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  declaredSize: Schema.Number,
  size: Schema.NullOr(Schema.Number),
  etag: Schema.NullOr(Schema.String),
  checksum: Schema.NullOr(Schema.String),
  source: Schema.NonEmptyString,
  status: ItemStatus,
  storageKey: Schema.NonEmptyString,
  stagingKey: Schema.NonEmptyString,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  properties: Properties,
});
export type KevaItem = typeof KevaItem.Type;

export const Operator = Schema.Literal(
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
);
export type Operator = typeof Operator.Type;

export const QueryKey = Schema.String.pipe(
  Schema.maxLength(PROPERTY_LIMITS.keyLength),
  Schema.filter((key) => isQueryKey(key), {
    message: () => "Invalid query key",
  }),
);

export const QueryCondition = Schema.Struct({
  key: QueryKey,
  op: Operator,
  value: Schema.optional(PropertyValue),
}).pipe(
  Schema.filter(
    ({ op, value }) => {
      if (op === "exists") return value === undefined;
      if (value === undefined) return false;
      if (op === "contains") return typeof value === "string" ||
        typeof value === "number" || typeof value === "boolean";
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        return typeof value === "string" || typeof value === "number";
      }
      return !Array.isArray(value);
    },
    { message: () => "Operator and value type are incompatible" },
  ),
);
export type QueryCondition = typeof QueryCondition.Type;

export const Query = Schema.Struct({
  where: Schema.optionalWith(Schema.Array(QueryCondition), {
    default: () => [],
  }),
  search: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  limit: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 1000)),
    { default: () => 100 },
  ),
  cursor: Schema.optional(Schema.String),
});
export type Query = typeof Query.Type;

export const QueryResult = Schema.Struct({
  items: Schema.Array(KevaItem),
  nextCursor: Schema.optional(Schema.String),
});
export type QueryResult = typeof QueryResult.Type;

export const BatchDelete = Schema.Struct({
  ids: Schema.Array(ItemId).pipe(
    Schema.minItems(1),
    Schema.maxItems(1000),
  ),
});
export type BatchDelete = typeof BatchDelete.Type;

export const BatchDeleteResult = Schema.Struct({
  deleted: Schema.Array(Schema.String),
  failed: Schema.Array(
    Schema.Struct({ id: Schema.String, error: Schema.String }),
  ),
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
  set: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: PropertyValue }),
    { default: () => ({}) },
  ),
  unset: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
});
export type ItemPatch = typeof ItemPatch.Type;

export const DownloadResult = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.String,
});
export type DownloadResult = typeof DownloadResult.Type;

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
  scopes: Schema.Array(Scope).pipe(Schema.minItems(1)),
  expiresAt: Schema.optional(Schema.String),
});
export type MintToken = typeof MintToken.Type;

export const MintTokenResult = Schema.Struct({
  token: Schema.String,
  record: TokenRecord,
});
export type MintTokenResult = typeof MintTokenResult.Type;

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { message: Schema.String },
) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
) {}
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
) {}
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
) {}
export class QuotaExceeded extends Schema.TaggedError<QuotaExceeded>()(
  "QuotaExceeded",
  { message: Schema.String },
) {}
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  "StorageUnavailable",
  { message: Schema.String },
) {}
export class Internal extends Schema.TaggedError<Internal>()(
  "Internal",
  { message: Schema.String },
) {}

export const KevaError = Schema.Union(
  ValidationError,
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  QuotaExceeded,
  StorageUnavailable,
  Internal,
);
export type KevaError = typeof KevaError.Type;

export const statusFor = (error: KevaError): number => {
  switch (error._tag) {
    case "ValidationError":
      return 400;
    case "Unauthorized":
      return 401;
    case "Forbidden":
      return 403;
    case "NotFound":
      return 404;
    case "Conflict":
      return 409;
    case "QuotaExceeded":
      return 413;
    case "StorageUnavailable":
      return 502;
    case "Internal":
      return 500;
  }
};
