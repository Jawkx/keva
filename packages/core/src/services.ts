import type {
  PropertyScalar,
  PropertyValue,
  ItemEvent,
  ItemEventsResult,
  KevaError,
  KevaItem,
  ItemStatus,
  Query,
  QueryResult,
  UsageResult,
} from "@keva/schema";
import { Context, type Effect } from "effect";

export interface BlobHead {
  readonly size: number;
  readonly etag: string | null;
  readonly contentType: string | null;
}

export interface PresignedRequest {
  readonly url: string;
  readonly expiresAt: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface BlobStoreService {
  readonly presignUpload: (
    key: string,
    size: number,
    contentType: string,
  ) => Effect.Effect<PresignedRequest, KevaError>;
  readonly presignDownload: (key: string) => Effect.Effect<PresignedRequest, KevaError>;
  readonly head: (key: string) => Effect.Effect<BlobHead | null, KevaError>;
  readonly copy: (sourceKey: string, destinationKey: string) => Effect.Effect<void, KevaError>;
  readonly delete: (key: string) => Effect.Effect<void, KevaError>;
  readonly devPut?: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
    token: string,
  ) => Effect.Effect<void, KevaError>;
  readonly devGet?: (
    key: string,
    token: string,
  ) => Effect.Effect<{ bytes: Uint8Array; contentType: string } | null, KevaError>;
}

export class BlobStore extends Context.Tag("@keva/core/BlobStore")<BlobStore, BlobStoreService>() {}

// Caps on autocomplete aggregations so responses stay small even for tenants
// with many distinct keys/values. Shared by every MetadataStore implementation.
export const SUGGESTION_KEY_LIMIT = 500;
export const SUGGESTION_VALUE_LIMIT = 100;

export interface ItemTransition {
  readonly status?: ItemStatus;
  readonly size?: number | null;
  readonly etag?: string | null;
  readonly contentType?: string;
  readonly updatedAt: string;
}

// A routed patch: `fields` holds user-writable column values keyed by canonical
// field key (e.g. "name") — each store maps the key to its own storage via the
// schema field registry — while `set`/`unset` carry the property-blob merge.
export interface ItemPatchInput {
  readonly fields: Readonly<Record<string, PropertyValue>>;
  readonly set: Readonly<Record<string, PropertyValue>>;
  readonly unset: readonly string[];
}

export interface MetadataStoreService {
  readonly insert: (item: KevaItem) => Effect.Effect<void, KevaError>;
  readonly get: (tenantId: string, id: string) => Effect.Effect<KevaItem | null, KevaError>;
  readonly transition: (
    tenantId: string,
    id: string,
    from: ReadonlyArray<ItemStatus>,
    patch: ItemTransition,
    olderThan?: string,
  ) => Effect.Effect<boolean, KevaError>;
  // `previous` is the row read inside the update's critical section, so
  // callers can diff before/after accurately even when patches race.
  readonly patch: (
    tenantId: string,
    id: string,
    patch: ItemPatchInput,
    updatedAt: string,
  ) => Effect.Effect<ItemPatchResult | null, KevaError>;
  readonly remove: (
    tenantId: string,
    id: string,
    expectedStatus: ItemStatus,
  ) => Effect.Effect<boolean, KevaError>;
  readonly query: (tenantId: string, query: Query) => Effect.Effect<QueryResult, KevaError>;
  // Storage totals + per-content-type breakdown across a tenant's ready items.
  readonly usage: (tenantId: string) => Effect.Effect<UsageResult, KevaError>;
  // Count + byte-sum of a tenant's items attributed to one `source`, across
  // pending AND ready (pending counts so concurrent share initiates can't blow
  // a quota; reapPending releases abandoned holds after the pending TTL).
  // bytes = sum(size ?? declaredSize) — declared size is the honest floor before
  // confirm verifies actual bytes. Powers per-share upload quotas.
  readonly sourceUsage: (
    tenantId: string,
    source: string,
  ) => Effect.Effect<{ readonly count: number; readonly bytes: number }, KevaError>;
  // Distinct property keys across a tenant's ready items, for key autocomplete.
  readonly propertyKeys: (tenantId: string) => Effect.Effect<ReadonlyArray<string>, KevaError>;
  // Distinct scalar values seen for one property key, for value autocomplete.
  readonly propertyValues: (
    tenantId: string,
    key: string,
  ) => Effect.Effect<ReadonlyArray<PropertyScalar>, KevaError>;
  readonly listByStatus: (
    status: ItemStatus,
    limit: number,
    olderThan?: string,
  ) => Effect.Effect<ReadonlyArray<KevaItem>, KevaError>;
  readonly appendEvent: (event: ItemEvent) => Effect.Effect<void, KevaError>;
  // Newest-first keyset pagination, same cursor format as `query`.
  readonly listEvents: (
    tenantId: string,
    itemId: string,
    options: ListEventsOptions,
  ) => Effect.Effect<ItemEventsResult, KevaError>;
}

export interface ListEventsOptions {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ItemPatchResult {
  readonly previous: KevaItem;
  readonly updated: KevaItem;
}

export class MetadataStore extends Context.Tag("@keva/core/MetadataStore")<
  MetadataStore,
  MetadataStoreService
>() {}
