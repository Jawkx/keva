import type {
  PropertyValue,
  KevaError,
  KevaItem,
  ItemStatus,
  Query,
  QueryResult,
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
  readonly presignDownload: (
    key: string,
  ) => Effect.Effect<PresignedRequest, KevaError>;
  readonly head: (
    key: string,
  ) => Effect.Effect<BlobHead | null, KevaError>;
  readonly copy: (
    sourceKey: string,
    destinationKey: string,
  ) => Effect.Effect<void, KevaError>;
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

export class BlobStore extends Context.Tag("@keva/core/BlobStore")<
  BlobStore,
  BlobStoreService
>() {}

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
  readonly get: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  readonly transition: (
    tenantId: string,
    id: string,
    from: ReadonlyArray<ItemStatus>,
    patch: ItemTransition,
    olderThan?: string,
  ) => Effect.Effect<boolean, KevaError>;
  readonly patch: (
    tenantId: string,
    id: string,
    patch: ItemPatchInput,
    updatedAt: string,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  readonly remove: (
    tenantId: string,
    id: string,
    expectedStatus: ItemStatus,
  ) => Effect.Effect<boolean, KevaError>;
  readonly query: (
    tenantId: string,
    query: Query,
  ) => Effect.Effect<QueryResult, KevaError>;
  readonly listByStatus: (
    status: ItemStatus,
    limit: number,
    olderThan?: string,
  ) => Effect.Effect<ReadonlyArray<KevaItem>, KevaError>;
}

export class MetadataStore extends Context.Tag("@keva/core/MetadataStore")<
  MetadataStore,
  MetadataStoreService
>() {}
