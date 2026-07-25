import { Schema } from "effect";
import {
  FIELD_BY_KEY,
  isPropertyKey,
  isQueryKey,
  PROPERTY_LIMITS,
  validateProperties,
} from "./fields.js";

export * from "./fields.js";
export * from "./conditions.js";
export * from "./billing.js";

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
  Schema.minLength(1),
  Schema.filter(
    (value) => new TextEncoder().encode(value).byteLength <= PROPERTY_LIMITS.stringBytes,
    { message: () => "String properties must be at most 8 KB" },
  ),
);

const PropertyArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Array(item).pipe(
    Schema.minItems(1),
    Schema.maxItems(PROPERTY_LIMITS.arrayItems),
    Schema.filter((values) => new Set(values).size === values.length, {
      message: () => "Array property values must be unique",
    }),
  );

export const PropertyValue = Schema.Union(
  PropertyString,
  Schema.Null,
  PropertyArray(PropertyString),
);
export type PropertyValue = typeof PropertyValue.Type;

export const Properties = Schema.Record({
  key: Schema.String,
  value: PropertyValue,
}).pipe(
  Schema.filter((properties) => validateProperties(properties) === null, {
    message: () => "Invalid properties",
  }),
);
export type Properties = typeof Properties.Type;

export const Scope = Schema.Literal("read", "write", "delete", "views", "shares", "admin");
export type Scope = typeof Scope.Type;

export const ItemStatus = Schema.Literal("pending", "confirming", "ready", "deleting");
export type ItemStatus = typeof ItemStatus.Type;

export const ItemId = Schema.String.pipe(Schema.pattern(ITEM_ID_PATTERN));
export type ItemId = typeof ItemId.Type;

// Accepts any RFC-3339 / ISO-8601 instant: date + time + zone, with optional
// fractional seconds and a numeric offset or `Z`. Rejects loose inputs like
// "2026" or "Jan 1 2020" that `Date.parse` would otherwise coerce.
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export const isIsoInstant = (value: string): boolean =>
  ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value));

export const isFutureInstant = (value: string, now = Date.now()): boolean =>
  isIsoInstant(value) && Date.parse(value) > now;

export const IsoInstant = Schema.String.pipe(
  Schema.filter(isIsoInstant, { message: () => "Expected an ISO-8601 instant" }),
);
export type IsoInstant = typeof IsoInstant.Type;

type CursorOrder = "created_at_asc" | "created_at_desc" | "size_asc" | "size_desc";
export type Cursor = readonly [sortValue: string | number, id: string, order?: CursorOrder];

export const encodeCursor = (cursor: Cursor): string => btoa(JSON.stringify(cursor));

export const decodeCursor = (cursor: string): Cursor | null => {
  try {
    const value = JSON.parse(atob(cursor)) as unknown;
    if (
      !Array.isArray(value) ||
      (value.length !== 2 && value.length !== 3) ||
      !(
        (typeof value[0] === "string" && Number.isFinite(Date.parse(value[0]))) ||
        (typeof value[0] === "number" && Number.isSafeInteger(value[0]) && value[0] >= 0)
      ) ||
      typeof value[1] !== "string" ||
      !ITEM_ID_PATTERN.test(value[1]) ||
      (value.length === 3 &&
        !["created_at_asc", "created_at_desc", "size_asc", "size_desc"].includes(value[2]))
    )
      return null;
    return value.length === 3
      ? [value[0], value[1], value[2] as CursorOrder]
      : [value[0], value[1]];
  } catch {
    return null;
  }
};

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
  "exists",
  "missing",
  "is_tag",
  "has_value",
  "has_any",
  "has_all",
  "contains_text",
  "contains_any",
);
export type Operator = typeof Operator.Type;

export const QueryKey = Schema.String.pipe(
  Schema.maxLength(PROPERTY_LIMITS.keyLength),
  Schema.filter((key) => isQueryKey(key), {
    message: () => "Invalid query key",
  }),
);

const QueryOperand = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Null,
  Schema.Array(Schema.String),
);

const isNonEmptyUniqueStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === "string" && entry.length > 0) &&
  new Set(value).size === value.length;

export const QueryCondition = Schema.Struct({
  key: QueryKey,
  op: Operator,
  value: Schema.optional(QueryOperand),
}).pipe(
  Schema.filter(
    ({ key, op, value }) => {
      const field = FIELD_BY_KEY.get(key);
      if (!field) {
        if (["exists", "missing", "is_tag"].includes(op)) return value === undefined;
        if (op === "has_value" || op === "contains_text")
          return typeof value === "string" && value.length > 0;
        if (op === "has_any" || op === "has_all" || op === "contains_any")
          return isNonEmptyUniqueStrings(value);
        return false;
      }

      if (op === "exists" || op === "missing") return !field.required && value === undefined;
      if (["is_tag", "has_value", "has_any", "has_all"].includes(op)) return false;
      const nullable = !field.required;
      if (op === "eq" || op === "neq") {
        if (value === null) return nullable;
        if (field.queryType === "number") return typeof value === "number";
        if (field.queryType === "timestamp")
          return typeof value === "string" && isIsoInstant(value);
        return typeof value === "string" && value.length > 0;
      }
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        return field.queryType === "number"
          ? typeof value === "number"
          : field.queryType === "timestamp" && typeof value === "string" && isIsoInstant(value);
      }
      if (op === "contains_text")
        return (
          (field.queryType === "string" || field.queryType === "nullable-string") &&
          typeof value === "string" &&
          value.length > 0
        );
      if (op === "contains_any")
        return (
          (field.queryType === "string" || field.queryType === "nullable-string") &&
          isNonEmptyUniqueStrings(value)
        );
      return false;
    },
    { message: () => "Operator and value type are incompatible" },
  ),
);
export type QueryCondition = typeof QueryCondition.Type;

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

export const AVATAR_VARIANTS = {
  beard: ["variant01", "variant02"],
  earrings: ["variant01", "variant02", "variant03"],
  eyebrows: [
    "variant01",
    "variant02",
    "variant03",
    "variant04",
    "variant05",
    "variant06",
    "variant07",
    "variant08",
    "variant09",
    "variant10",
    "variant11",
    "variant12",
    "variant13",
  ],
  eyes: [
    "variant01",
    "variant02",
    "variant03",
    "variant04",
    "variant05",
    "variant06",
    "variant07",
    "variant08",
    "variant09",
    "variant10",
    "variant11",
    "variant12",
    "variant13",
    "variant14",
    "variant15",
    "variant16",
    "variant17",
    "variant18",
    "variant19",
    "variant20",
    "variant21",
    "variant22",
    "variant23",
    "variant24",
  ],
  glasses: ["variant01", "variant02", "variant03", "variant04", "variant05"],
  hair: [
    "variant01",
    "variant02",
    "variant03",
    "variant04",
    "variant05",
    "variant06",
    "variant07",
    "variant08",
    "variant09",
    "variant10",
    "variant11",
    "variant12",
    "variant13",
    "variant14",
    "variant15",
    "variant16",
    "variant17",
    "variant18",
    "variant19",
    "variant20",
    "variant21",
    "variant22",
    "variant23",
    "variant24",
    "variant25",
    "variant26",
    "variant27",
    "variant28",
    "variant29",
    "variant30",
    "variant31",
    "variant32",
    "variant33",
    "variant34",
    "variant35",
    "variant36",
    "variant37",
    "variant38",
    "variant39",
    "variant40",
    "variant41",
    "variant42",
    "variant43",
    "variant44",
    "variant45",
    "variant46",
    "variant47",
    "variant48",
  ],
  head: ["variant01", "variant02", "variant03", "variant04"],
  mouth: [
    "happy01",
    "happy02",
    "happy03",
    "happy04",
    "happy05",
    "happy06",
    "happy07",
    "happy08",
    "happy09",
    "happy10",
    "happy11",
    "happy12",
    "happy13",
    "happy14",
    "happy15",
    "happy16",
    "happy17",
    "happy18",
    "sad01",
    "sad02",
    "sad03",
    "sad04",
    "sad05",
    "sad06",
    "sad07",
    "sad08",
    "sad09",
  ],
  nose: ["variant01", "variant02", "variant03", "variant04", "variant05", "variant06"],
} as const;

const OptionalAvatarFeature = <Values extends readonly [string, ...string[]]>(values: Values) =>
  Schema.optional(Schema.NullOr(Schema.Literal(...values)));

export const AvatarRecipe = Schema.Struct({
  version: Schema.Literal(1),
  seed: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  beard: OptionalAvatarFeature(AVATAR_VARIANTS.beard),
  earrings: OptionalAvatarFeature(AVATAR_VARIANTS.earrings),
  eyebrows: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.eyebrows)),
  eyes: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.eyes)),
  freckles: Schema.optional(Schema.Boolean),
  glasses: OptionalAvatarFeature(AVATAR_VARIANTS.glasses),
  hair: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.hair)),
  hairAccessory: Schema.optional(Schema.NullOr(Schema.Literal("flowers"))),
  head: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.head)),
  mouth: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.mouth)),
  nose: Schema.optional(Schema.Literal(...AVATAR_VARIANTS.nose)),
});
export type AvatarRecipe = typeof AvatarRecipe.Type;

// Who performed an action. An OAuth-MCP call carries both the authorizing
// `user` and the acting `agent`; names are display snapshots — `agent.name` is
// self-asserted via dynamic client registration, never authorize on it.
export const Actor = Schema.Struct({
  user: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      avatar: Schema.optional(AvatarRecipe),
    }),
  ),
  agent: Schema.optional(Schema.Struct({ clientId: Schema.String, name: Schema.String })),
  token: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.String })),
  share: Schema.optional(Schema.Struct({ grantId: Schema.String, name: Schema.String })),
});
export type Actor = typeof Actor.Type;

const PrincipalBase = {
  tenantId: Schema.NonEmptyString,
  scopes: Schema.Array(Scope),
  actor: Schema.optional(Actor),
};

export const SessionPrincipal = Schema.Struct({ ...PrincipalBase, via: Schema.Literal("session") });
export type SessionPrincipal = typeof SessionPrincipal.Type;

export const TokenPrincipal = Schema.Struct({ ...PrincipalBase, via: Schema.Literal("token") });
export type TokenPrincipal = typeof TokenPrincipal.Type;

export const SharePrincipal = Schema.Struct({
  ...PrincipalBase,
  via: Schema.Literal("share"),
  share: ShareGrantContext,
});
export type SharePrincipal = typeof SharePrincipal.Type;

export const Principal = Schema.Union(SessionPrincipal, TokenPrincipal, SharePrincipal);
export type Principal = typeof Principal.Type;

export const QueryOrder = Schema.Literal(
  "created_at_asc",
  "created_at_desc",
  "size_asc",
  "size_desc",
);
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
  offset: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER)),
  ),
  order: Schema.optionalWith(QueryOrder, {
    default: () => "created_at_asc",
  }),
}).pipe(
  Schema.filter((query) => query.cursor === undefined || query.offset === undefined, {
    message: () => "Query cursor and offset are mutually exclusive",
  }),
);
export type Query = typeof Query.Type;

export const QueryResult = Schema.Struct({
  items: Schema.Array(KevaItem),
  nextCursor: Schema.optional(Schema.String),
  totalCount: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER)),
  ),
});
export type QueryResult = typeof QueryResult.Type;

export const PropertyKeysResult = Schema.Struct({
  keys: Schema.Array(Schema.String),
});
export type PropertyKeysResult = typeof PropertyKeysResult.Type;

export const PropertyScalar = Schema.String;
export type PropertyScalar = typeof PropertyScalar.Type;

export const PropertyValuesResult = Schema.Struct({
  values: Schema.Array(PropertyScalar),
});
export type PropertyValuesResult = typeof PropertyValuesResult.Type;

// Observed value shapes for one property key across a tenant's ready items.
// "tag" is the product name for a bare `null` value (pure membership tag); a
// key can be mixed, e.g. ["tag", "string"] when some items carry it bare.
export const PropertyKind = Schema.Literal("tag", "string", "array");
export type PropertyKind = typeof PropertyKind.Type;

export const PropertySummary = Schema.Struct({
  key: Schema.String,
  kinds: Schema.Array(PropertyKind),
  values: Schema.Array(PropertyScalar),
});
export type PropertySummary = typeof PropertySummary.Type;

export const PropertySummaryResult = Schema.Struct({
  entries: Schema.Array(PropertySummary),
});
export type PropertySummaryResult = typeof PropertySummaryResult.Type;

export const ContentTypeUsage = Schema.Struct({
  contentType: Schema.String,
  count: Schema.Number,
  bytes: Schema.Number,
});
export type ContentTypeUsage = typeof ContentTypeUsage.Type;

export const UsageResult = Schema.Struct({
  itemCount: Schema.Number,
  totalBytes: Schema.Number,
  accountedItems: Schema.Number,
  quotaBytes: Schema.NullOr(Schema.Number),
  quotaItems: Schema.NullOr(Schema.Number),
  remainingBytes: Schema.NullOr(Schema.Number),
  remainingItems: Schema.NullOr(Schema.Number),
  period: Schema.NullOr(
    Schema.Struct({
      startsAt: Schema.String,
      endsAt: Schema.String,
      uploadsUsed: Schema.Number,
      uploadsReserved: Schema.Number,
      uploadsLimit: Schema.Number,
      apiRequestsUsed: Schema.Number,
      apiRequestsLimit: Schema.Number,
    }),
  ),
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

export const ItemEventAction = Schema.Literal(
  "uploaded",
  "updated",
  "renamed",
  "properties_changed",
  "deleted",
);
export type ItemEventAction = typeof ItemEventAction.Type;

const PropertyChanges = Schema.Struct({
  set: Schema.optional(Schema.Record({ key: Schema.String, value: PropertyValue })),
  previous: Schema.optional(Schema.Record({ key: Schema.String, value: PropertyValue })),
  unset: Schema.optional(Schema.Array(Schema.String)),
});

export const ItemEventPayload = Schema.Struct({
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  contentType: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  ...PropertyChanges.fields,
  name: Schema.optional(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
    }),
  ),
  properties: Schema.optional(PropertyChanges),
});
export type ItemEventPayload = typeof ItemEventPayload.Type;

// `itemName` and `actor` are write-time snapshots; events outlive the item and
// the acting credential. `actor` is null for unattributed (backfilled) events.
export const ItemEvent = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  itemId: ItemId,
  itemName: Schema.String,
  action: ItemEventAction,
  actor: Schema.NullOr(Actor),
  payload: ItemEventPayload,
  createdAt: Schema.String,
});
export type ItemEvent = typeof ItemEvent.Type;

export const ItemEventsResult = Schema.Struct({
  events: Schema.Array(ItemEvent),
  nextCursor: Schema.optional(Schema.String),
});
export type ItemEventsResult = typeof ItemEventsResult.Type;

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
  expiresAt: Schema.optional(IsoInstant),
});
export type MintToken = typeof MintToken.Type;

export const MintTokenResult = Schema.Struct({
  token: Schema.String,
  record: TokenRecord,
});
export type MintTokenResult = typeof MintTokenResult.Type;

export const ViewRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.NonEmptyString,
  // A Lucide icon key resolved by the web client; null = default icon.
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

export const UpdateView = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  icon: Schema.optional(Schema.String),
  conditions: Schema.optional(Schema.Array(QueryCondition)),
});
export type UpdateView = typeof UpdateView.Type;

export const ShareGrantRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  viewId: Schema.String,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope),
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
  viewId: Schema.optional(Schema.String),
  view: Schema.optional(CreateView),
  scopes: Schema.Array(ShareScope).pipe(Schema.minItems(1)),
  writeStamp: Schema.optional(Properties),
  maxItemBytes: Schema.optional(PositiveInt),
  maxTotalBytes: Schema.optional(PositiveInt),
  maxItems: Schema.optional(PositiveInt),
  expiresAt: Schema.optional(IsoInstant),
}).pipe(
  Schema.filter((grant) => (grant.viewId === undefined) !== (grant.view === undefined), {
    message: () => "A share requires exactly one view reference",
  }),
  Schema.filter((grant) => !grant.scopes.includes("write") || grant.writeStamp !== undefined, {
    message: () => "Write grants require a writeStamp",
  }),
);
export type CreateShareGrant = typeof CreateShareGrant.Type;

export const CreateShareGrantResult = Schema.Struct({
  token: Schema.String, // one-time plaintext keva_sh_{id}_{secret}
  record: ShareGrantRecord,
  view: ViewRecord,
});
export type CreateShareGrantResult = typeof CreateShareGrantResult.Type;

export const AccountShareStatus = Schema.Literal("pending", "accepted");
export type AccountShareStatus = typeof AccountShareStatus.Type;

export const CreateAccountShare = Schema.Struct({
  recipientEmail: Schema.NonEmptyString.pipe(Schema.maxLength(320)),
  viewId: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope).pipe(Schema.minItems(1)),
  writeStamp: Schema.optional(Properties),
  maxItemBytes: Schema.optional(PositiveInt),
  maxTotalBytes: Schema.optional(PositiveInt),
  maxItems: Schema.optional(PositiveInt),
  expiresAt: Schema.optional(IsoInstant),
}).pipe(
  Schema.filter((grant) => !grant.scopes.includes("write") || grant.writeStamp !== undefined, {
    message: () => "Write grants require a writeStamp",
  }),
);
export type CreateAccountShare = typeof CreateAccountShare.Type;

const SharePerson = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  avatar: AvatarRecipe,
});

export const AccountShareRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  viewId: Schema.String,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope),
  conditions: Schema.Array(QueryCondition),
  writeStamp: Schema.NullOr(Properties),
  maxItemBytes: Schema.NullOr(Schema.Number),
  maxTotalBytes: Schema.NullOr(Schema.Number),
  maxItems: Schema.NullOr(Schema.Number),
  status: AccountShareStatus,
  recipient: SharePerson,
  createdAt: Schema.String,
  acceptedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
});
export type AccountShareRecord = typeof AccountShareRecord.Type;

export const ReceivedShare = Schema.Struct({
  id: Schema.String,
  name: Schema.NonEmptyString,
  icon: Schema.NullOr(Schema.String),
  scopes: Schema.Array(ShareScope),
  status: AccountShareStatus,
  owner: SharePerson,
  createdAt: Schema.String,
  acceptedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
});
export type ReceivedShare = typeof ReceivedShare.Type;

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

export const AccountShareSelf = Schema.Struct({
  ...ShareSelf.fields,
  owner: SharePerson,
});
export type AccountShareSelf = typeof AccountShareSelf.Type;

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
  source: Schema.NonEmptyString,
  status: ItemStatus,
  revision: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  properties: Properties,
});
export type SharedItem = typeof SharedItem.Type;

export const OwnerItem = SharedItem;
export type OwnerItem = typeof OwnerItem.Type;

export const OwnerInitiateUploadResult = Schema.Struct({
  item: OwnerItem,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type OwnerInitiateUploadResult = typeof OwnerInitiateUploadResult.Type;

export const toSharedItem = (item: KevaItem): SharedItem => ({
  id: item.id,
  name: item.name,
  contentType: item.contentType,
  declaredSize: item.declaredSize,
  size: item.size,
  etag: item.etag,
  source: item.source,
  status: item.status,
  revision: item.revision,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  properties: item.properties,
});

export const toOwnerItem = (item: KevaItem): OwnerItem => toSharedItem(item);

export const SharedQueryResult = Schema.Struct({
  items: Schema.Array(SharedItem),
  nextCursor: Schema.optional(Schema.String),
  totalCount: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER)),
  ),
});
export type SharedQueryResult = typeof SharedQueryResult.Type;

export const OwnerQueryResult = Schema.Struct({
  items: Schema.Array(OwnerItem),
  nextCursor: Schema.optional(Schema.String),
  totalCount: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER)),
  ),
});
export type OwnerQueryResult = typeof OwnerQueryResult.Type;

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
  grantIds: Schema.optional(Schema.Array(Schema.String)),
}) {}
export class QuotaExceeded extends Schema.TaggedError<QuotaExceeded>()("QuotaExceeded", {
  message: Schema.String,
}) {}
export class SubscriptionRequired extends Schema.TaggedError<SubscriptionRequired>()(
  "SubscriptionRequired",
  { message: Schema.String },
) {}
export class RateLimitExceeded extends Schema.TaggedError<RateLimitExceeded>()(
  "RateLimitExceeded",
  { message: Schema.String, resetsAt: Schema.String },
) {}
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
  SubscriptionRequired,
  RateLimitExceeded,
  StorageUnavailable,
  Internal,
);
export type KevaError = typeof KevaError.Type;

export const BatchPatchResult = Schema.Struct({
  updated: Schema.Array(
    Schema.Struct({
      id: ItemId,
      revision: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
    }),
  ),
  failed: Schema.Array(Schema.Struct({ id: ItemId, error: KevaError })),
});
export type BatchPatchResult = typeof BatchPatchResult.Type;

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
    case "SubscriptionRequired":
      return 402;
    case "RateLimitExceeded":
      return 429;
    case "StorageUnavailable":
      return 502;
    case "Internal":
      return 500;
  }
};
