import { Schema } from "effect";
import { isPropertyKey, isQueryKey, PROPERTY_LIMITS } from "./fields.js";

export * from "./fields.js";
export * from "./conditions.js";

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
    (value) => new TextEncoder().encode(value).byteLength <= PROPERTY_LIMITS.stringBytes,
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
  Schema.filter((properties) => Object.keys(properties).every(isPropertyKey), {
    message: () => "Invalid or reserved property key",
  }),
  Schema.filter((properties) => Object.keys(properties).length <= PROPERTY_LIMITS.keys, {
    message: () => "An item may have at most 256 properties",
  }),
  Schema.filter((properties) => encodedBytes(properties) <= PROPERTY_LIMITS.totalBytes, {
    message: () => "Properties must be at most 64 KB in total",
  }),
);
export type Properties = typeof Properties.Type;

export const Scope = Schema.Literal("read", "write", "delete", "admin");
export type Scope = typeof Scope.Type;

// Principal is defined below, after QueryCondition — a share principal carries
// the grant's conditions, which reuse the QueryCondition schema.

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
  "in",
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
      if (op === "contains")
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
      // `in` matches when the field satisfies `contains` against ANY listed
      // value (an OR over alternatives), so it takes a non-empty scalar array.
      if (op === "in")
        return (
          Array.isArray(value) &&
          value.length > 0 &&
          value.every(
            (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
          )
        );
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        return typeof value === "string" || typeof value === "number";
      }
      return !Array.isArray(value);
    },
    { message: () => "Operator and value type are incompatible" },
  ),
);
export type QueryCondition = typeof QueryCondition.Type;

// The two scopes a share grant can carry. Distinct from the tenant-wide `Scope`
// (which includes delete/admin) — a share is only ever read and/or write.
export const ShareScope = Schema.Literal("read", "write");
export type ShareScope = typeof ShareScope.Type;

// The slice of a resolved share grant the engine needs to enforce access. Built
// by the auth layer at token-resolution time and carried on the Principal, so
// the engine never re-queries the grant row. `limits` are the raw quota values
// (null = unlimited); the engine reads current usage separately.
export const ShareGrantContext = Schema.Struct({
  grantId: Schema.NonEmptyString,
  conditions: Schema.Array(QueryCondition),
  writeStamp: Schema.optional(Properties),
  limits: Schema.optional(
    Schema.Struct({
      maxItemBytes: Schema.NullOr(Schema.Number),
      maxTotalBytes: Schema.NullOr(Schema.Number),
      maxItems: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type ShareGrantContext = typeof ShareGrantContext.Type;

// `share` is present iff `via === "share"`; the engine treats its presence, not
// the discriminant alone, as the switch for share-scoped enforcement.
export const Principal = Schema.Struct({
  tenantId: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  via: Schema.Literal("session", "token", "share"),
  share: Schema.optional(ShareGrantContext),
});
export type Principal = typeof Principal.Type;

export const QueryOrder = Schema.Literal("created_at_asc", "created_at_desc");
export type QueryOrder = typeof QueryOrder.Type;

export const Query = Schema.Struct({
  where: Schema.optionalWith(Schema.Array(QueryCondition), {
    default: () => [],
  }),
  search: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  limit: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.between(1, 1000)), {
    default: () => 100,
  }),
  cursor: Schema.optional(Schema.String),
  order: Schema.optionalWith(QueryOrder, {
    default: () => "created_at_asc",
  }),
});
export type Query = typeof Query.Type;

export const QueryResult = Schema.Struct({
  items: Schema.Array(KevaItem),
  nextCursor: Schema.optional(Schema.String),
});
export type QueryResult = typeof QueryResult.Type;

// Distinct property keys used across a tenant's items — powers key autocomplete
// in the editor and filter UIs.
export const PropertyKeysResult = Schema.Struct({
  keys: Schema.Array(Schema.String),
});
export type PropertyKeysResult = typeof PropertyKeysResult.Type;

// Distinct scalar values seen for a single property key across a tenant's items.
// Arrays and nulls are excluded — only values a single-line input can suggest.
export const PropertyScalar = Schema.Union(Schema.String, Schema.Number, Schema.Boolean);
export type PropertyScalar = typeof PropertyScalar.Type;

export const PropertyValuesResult = Schema.Struct({
  values: Schema.Array(PropertyScalar),
});
export type PropertyValuesResult = typeof PropertyValuesResult.Type;

// Storage usage for a tenant: totals plus a per-content-type breakdown. Derived
// live from `ready` items, so `sum(byType.bytes) === totalBytes` and
// `sum(byType.count) === itemCount` always hold.
export const ContentTypeUsage = Schema.Struct({
  contentType: Schema.String,
  count: Schema.Number,
  bytes: Schema.Number,
});
export type ContentTypeUsage = typeof ContentTypeUsage.Type;

export const UsageResult = Schema.Struct({
  itemCount: Schema.Number,
  totalBytes: Schema.Number,
  byType: Schema.Array(ContentTypeUsage),
});
export type UsageResult = typeof UsageResult.Type;

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
  set: Schema.optionalWith(Schema.Record({ key: Schema.String, value: PropertyValue }), {
    default: () => ({}),
  }),
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

// ── Views ────────────────────────────────────────────────────────────────

// A named, saved filter — the owner's first-class navigation object. `conditions`
// reuse the QueryCondition schema; a share grant references a view and reads its
// conditions live, so editing a view updates any link built on it.
export const ViewRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  // A HugeIcons key resolved to an icon by the web client; null = default icon.
  icon: Schema.NullOr(Schema.String),
  conditions: Schema.Array(QueryCondition),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ViewRecord = typeof ViewRecord.Type;

export const CreateView = Schema.Struct({
  name: Schema.NonEmptyString,
  icon: Schema.optional(Schema.String),
  conditions: Schema.Array(QueryCondition),
});
export type CreateView = typeof CreateView.Type;

// All fields optional so a caller can rename, re-icon, or re-filter
// independently. An empty patch is a no-op the store tolerates.
export const UpdateView = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  icon: Schema.optional(Schema.String),
  conditions: Schema.optional(Schema.Array(QueryCondition)),
});
export type UpdateView = typeof UpdateView.Type;

// ── Sharing ──────────────────────────────────────────────────────────────

// A stored share grant as returned to its owner. Never includes the secret.
// Nullable fields serialize as `null` (not absent) so the frontend can rely on
// their presence.
export const ShareGrantRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  viewId: Schema.String,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope),
  // Read live from the referenced view (not stored on the grant), so the owner
  // UI can render what the link exposes and it tracks view edits.
  conditions: Schema.Array(QueryCondition),
  writeStamp: Schema.NullOr(Properties),
  maxItemBytes: Schema.NullOr(Schema.Number),
  maxTotalBytes: Schema.NullOr(Schema.Number),
  maxItems: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type ShareGrantRecord = typeof ShareGrantRecord.Type;

const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0));

// Owner request to mint a share grant on an existing view (`viewId`). One
// cross-field invariant is checkable here — a write grant must carry a
// writeStamp. The other two write-soundness invariants (conditions may only
// reference plain property keys, and the stamp must satisfy every condition)
// depend on the view's conditions, which aren't in this payload; the server
// loads the view and enforces them in ShareGrantStore.create.
export const CreateShareGrant = Schema.Struct({
  name: Schema.NonEmptyString,
  viewId: Schema.String,
  scopes: Schema.Array(ShareScope).pipe(Schema.minItems(1)),
  writeStamp: Schema.optional(Properties),
  maxItemBytes: Schema.optional(PositiveInt),
  maxTotalBytes: Schema.optional(PositiveInt),
  maxItems: Schema.optional(PositiveInt),
  expiresAt: Schema.optional(Schema.String), // parity with MintToken: no future-date check
}).pipe(
  Schema.filter((grant) => !grant.scopes.includes("write") || grant.writeStamp !== undefined, {
    message: () => "Write grants require a writeStamp",
  }),
);
export type CreateShareGrant = typeof CreateShareGrant.Type;

export const CreateShareGrantResult = Schema.Struct({
  token: Schema.String, // one-time plaintext keva_sh_{id}_{secret}
  record: ShareGrantRecord,
});
export type CreateShareGrantResult = typeof CreateShareGrantResult.Type;

// Public self-description a share visitor sees. Conditions and writeStamp are
// deliberately withheld (they may encode private tenant taxonomy). `upload` is
// null unless the grant carries write scope.
export const ShareSelf = Schema.Struct({
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope),
  expiresAt: Schema.NullOr(Schema.String),
  upload: Schema.NullOr(
    Schema.Struct({
      maxItemBytes: Schema.NullOr(Schema.Number),
      maxTotalBytes: Schema.NullOr(Schema.Number),
      maxItems: Schema.NullOr(Schema.Number),
      usedBytes: Schema.Number,
      usedItems: Schema.Number,
    }),
  ),
});
export type ShareSelf = typeof ShareSelf.Type;

// A KevaItem with the tenant-internal storage fields (tenantId, storageKey,
// stagingKey) removed. Everything a share visitor receives is redacted to this
// shape at the route boundary.
export const SharedItem = Schema.Struct({
  id: ItemId,
  name: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  declaredSize: Schema.Number,
  size: Schema.NullOr(Schema.Number),
  etag: Schema.NullOr(Schema.String),
  checksum: Schema.NullOr(Schema.String),
  source: Schema.NonEmptyString,
  status: ItemStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  properties: Properties,
});
export type SharedItem = typeof SharedItem.Type;

export const toSharedItem = (item: KevaItem): SharedItem => ({
  id: item.id,
  name: item.name,
  contentType: item.contentType,
  declaredSize: item.declaredSize,
  size: item.size,
  etag: item.etag,
  checksum: item.checksum,
  source: item.source,
  status: item.status,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  properties: item.properties,
});

export const SharedQueryResult = Schema.Struct({
  items: Schema.Array(SharedItem),
  nextCursor: Schema.optional(Schema.String),
});
export type SharedQueryResult = typeof SharedQueryResult.Type;

export const SharedInitiateUploadResult = Schema.Struct({
  item: SharedItem,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type SharedInitiateUploadResult = typeof SharedInitiateUploadResult.Type;

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.String,
}) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
}) {}
export class QuotaExceeded extends Schema.TaggedError<QuotaExceeded>()("QuotaExceeded", {
  message: Schema.String,
}) {}
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  "StorageUnavailable",
  { message: Schema.String },
) {}
export class Internal extends Schema.TaggedError<Internal>()("Internal", {
  message: Schema.String,
}) {}

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
