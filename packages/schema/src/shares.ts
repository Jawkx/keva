import { Schema } from "effect";
import { AvatarRecipe } from "./avatar.js";
import { IsoInstant, ItemId, ItemStatus } from "./common.js";
import { type KevaItem } from "./item.js";
import { Properties } from "./properties.js";
import { QueryCondition } from "./query.js";
import { ShareScope } from "./share-context.js";
import { CreateView, ViewRecord } from "./views.js";

export const ShareGrantRecord = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  viewId: Schema.String,
  name: Schema.NonEmptyString,
  scopes: Schema.Array(ShareScope),
  conditions: Schema.Array(QueryCondition),
  writeStamp: Schema.NullOr(Properties),
  allowOwnDelete: Schema.Boolean,
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
  allowOwnDelete: Schema.optional(Schema.Boolean),
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
  Schema.filter((grant) => !grant.allowOwnDelete || grant.scopes.includes("write"), {
    message: () => "Deleting own uploads requires write access",
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
  allowOwnDelete: Schema.optional(Schema.Boolean),
  maxItemBytes: Schema.optional(PositiveInt),
  maxTotalBytes: Schema.optional(PositiveInt),
  maxItems: Schema.optional(PositiveInt),
  expiresAt: Schema.optional(IsoInstant),
}).pipe(
  Schema.filter((grant) => !grant.scopes.includes("write") || grant.writeStamp !== undefined, {
    message: () => "Write grants require a writeStamp",
  }),
  Schema.filter((grant) => !grant.allowOwnDelete || grant.scopes.includes("write"), {
    message: () => "Deleting own uploads requires write access",
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
  allowOwnDelete: Schema.Boolean,
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
  allowOwnDelete: Schema.Boolean,
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
  allowOwnDelete: Schema.Boolean,
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
  icon: Schema.NullOr(Schema.String),
  owner: SharePerson,
});
export type AccountShareSelf = typeof AccountShareSelf.Type;

// A KevaItem with tenant-internal storage and uploader identity removed.
// Everything a share visitor receives is redacted to this shape at the route boundary.
const RedactedItemFields = {
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
};

export const SharedItem = Schema.Struct({
  ...RedactedItemFields,
  canDelete: Schema.Boolean,
});
export type SharedItem = typeof SharedItem.Type;

export const OwnerItem = Schema.Struct(RedactedItemFields);
export type OwnerItem = typeof OwnerItem.Type;

export const OwnerInitiateUploadResult = Schema.Struct({
  item: OwnerItem,
  uploadUrl: Schema.String,
  expiresAt: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type OwnerInitiateUploadResult = typeof OwnerInitiateUploadResult.Type;

export const toOwnerItem = (item: KevaItem): OwnerItem => ({
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

export const toSharedItem = (item: KevaItem, canDelete = false): SharedItem => ({
  ...toOwnerItem(item),
  canDelete,
});

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
