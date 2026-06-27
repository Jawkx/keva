import { Schema } from "effect";

export const ATTRIBUTE_LIMITS = {
  keys: 256,
  keyLength: 128,
  stringBytes: 8 * 1024,
  arrayItems: 256,
  totalBytes: 64 * 1024,
} as const;

const encodedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const queryKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const systemQueryKeys = new Set([
  "system.content_type",
  "system.size",
  "system.etag",
  "system.checksum",
  "system.source",
  "system.status",
  "system.created_at",
  "system.updated_at",
]);

export const AttributeKey = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  Schema.maxLength(ATTRIBUTE_LIMITS.keyLength),
  Schema.filter(
    (key) => !key.startsWith("system.") && !key.startsWith("keva."),
    { message: () => "Attribute keys cannot use reserved namespaces" },
  ),
);
export type AttributeKey = typeof AttributeKey.Type;

export const AttributeString = Schema.String.pipe(
  Schema.filter(
    (value) =>
      new TextEncoder().encode(value).byteLength <= ATTRIBUTE_LIMITS.stringBytes,
    { message: () => "String attributes must be at most 8 KB" },
  ),
);

const AttributeArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Array(item).pipe(Schema.maxItems(ATTRIBUTE_LIMITS.arrayItems));

export const AttributeValue = Schema.Union(
  AttributeString,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  AttributeArray(AttributeString),
  AttributeArray(Schema.Number),
  AttributeArray(Schema.Boolean),
);
export type AttributeValue = typeof AttributeValue.Type;

export const Attributes = Schema.Record({
  key: Schema.String,
  value: AttributeValue,
}).pipe(
  Schema.filter(
    (attributes) =>
      Object.keys(attributes).every(
        (key) =>
          queryKeyPattern.test(key) &&
          key.length <= ATTRIBUTE_LIMITS.keyLength &&
          !key.startsWith("system.") &&
          !key.startsWith("keva."),
      ),
    { message: () => "Invalid or reserved attribute key" },
  ),
  Schema.filter(
    (attributes) => Object.keys(attributes).length <= ATTRIBUTE_LIMITS.keys,
    { message: () => "An object may have at most 256 attributes" },
  ),
  Schema.filter(
    (attributes) => encodedBytes(attributes) <= ATTRIBUTE_LIMITS.totalBytes,
    { message: () => "Attributes must be at most 64 KB in total" },
  ),
);
export type Attributes = typeof Attributes.Type;

export const Scope = Schema.Literal("read", "write", "delete", "admin");
export type Scope = typeof Scope.Type;

export const Principal = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  via: Schema.Literal("session", "token"),
});
export type Principal = typeof Principal.Type;

export const ObjectStatus = Schema.Literal("pending", "ready", "deleting");
export type ObjectStatus = typeof ObjectStatus.Type;

export const KevaObject = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  declaredSize: Schema.Number,
  size: Schema.NullOr(Schema.Number),
  etag: Schema.NullOr(Schema.String),
  checksum: Schema.NullOr(Schema.String),
  source: Schema.NonEmptyString,
  status: ObjectStatus,
  storageKey: Schema.NonEmptyString,
  stagingKey: Schema.NonEmptyString,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  attributes: Attributes,
});
export type KevaObject = typeof KevaObject.Type;

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
  Schema.maxLength(ATTRIBUTE_LIMITS.keyLength),
  Schema.filter(
    (key) =>
      key === "id" ||
      key === "name" ||
      systemQueryKeys.has(key) ||
      (!key.startsWith("system.") &&
        queryKeyPattern.test(key)),
    { message: () => "Invalid query key" },
  ),
);

export const QueryCondition = Schema.Struct({
  key: QueryKey,
  op: Operator,
  value: Schema.optional(AttributeValue),
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
  objects: Schema.Array(KevaObject),
  nextCursor: Schema.optional(Schema.String),
});
export type QueryResult = typeof QueryResult.Type;

export const InitiateUpload = Schema.Struct({
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  size: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  source: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => "upload",
  }),
  attributes: Schema.optionalWith(Attributes, { default: () => ({}) }),
});
export type InitiateUpload = typeof InitiateUpload.Type;

export const InitiateUploadResult = Schema.Struct({
  object: KevaObject,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type InitiateUploadResult = typeof InitiateUploadResult.Type;

export const AttributePatch = Schema.Struct({
  set: Schema.optionalWith(Attributes, { default: () => ({}) }),
  unset: Schema.optionalWith(Schema.Array(AttributeKey), { default: () => [] }),
});
export type AttributePatch = typeof AttributePatch.Type;

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
