import type {
  AttributePatch,
  KevaError,
  KevaObject,
  ObjectStatus,
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

export interface ObjectTransition {
  readonly status?: ObjectStatus;
  readonly size?: number | null;
  readonly etag?: string | null;
  readonly contentType?: string;
  readonly updatedAt: string;
}

export interface MetadataStoreService {
  readonly insert: (object: KevaObject) => Effect.Effect<void, KevaError>;
  readonly get: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<KevaObject | null, KevaError>;
  readonly transition: (
    tenantId: string,
    id: string,
    from: ReadonlyArray<ObjectStatus>,
    patch: ObjectTransition,
    olderThan?: string,
  ) => Effect.Effect<boolean, KevaError>;
  readonly patchAttributes: (
    tenantId: string,
    id: string,
    patch: AttributePatch,
    updatedAt: string,
  ) => Effect.Effect<KevaObject | null, KevaError>;
  readonly remove: (
    tenantId: string,
    id: string,
    expectedStatus: ObjectStatus,
  ) => Effect.Effect<boolean, KevaError>;
  readonly query: (
    tenantId: string,
    query: Query,
  ) => Effect.Effect<QueryResult, KevaError>;
  readonly listByStatus: (
    status: ObjectStatus,
    limit: number,
    olderThan?: string,
  ) => Effect.Effect<ReadonlyArray<KevaObject>, KevaError>;
}

export class MetadataStore extends Context.Tag("@keva/core/MetadataStore")<
  MetadataStore,
  MetadataStoreService
>() {}
