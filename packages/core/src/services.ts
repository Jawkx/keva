import type {
  PropertyScalar,
  PropertySuggestion,
  PropertySummary,
  PropertyValue,
  ItemPresentation,
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
  readonly copy: (
    sourceKey: string,
    destinationKey: string,
    sourceEtag?: string | null,
  ) => Effect.Effect<void, KevaError>;
  readonly delete: (key: string) => Effect.Effect<void, KevaError>;
}

export class BlobStore extends Context.Service<BlobStore, BlobStoreService>()(
  "@keva/core/BlobStore",
) {}

export const SUGGESTION_KEY_LIMIT = 500;
export const SUGGESTION_VALUE_LIMIT = 100;
export const PROPERTY_SEARCH_LIMIT = 12;
export const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export interface ItemTransition {
  readonly status?: ItemStatus;
  readonly size?: number | null;
  readonly etag?: string | null;
  readonly contentType?: string;
  readonly updatedAt: string;
}

export interface ItemPatchInput {
  readonly fields: Readonly<Record<string, PropertyValue>>;
  readonly set: Readonly<Record<string, PropertyValue>>;
  readonly unset: readonly string[];
  readonly presentation?: ItemPresentation;
}

export interface UploadAttempt {
  readonly id: string;
  readonly tenantId: string;
  readonly itemId: string | null;
  readonly retryKey: string | null;
  readonly requestHash: string | null;
  readonly stagingKey: string;
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly uploadHeaders: Readonly<Record<string, string>>;
  readonly expectedSize: number;
  readonly expiresAt: string;
  readonly state: "pending" | "confirming" | "confirmed" | "abandoned";
  readonly observedEtag: string | null;
  readonly cleanupAfter: string;
  readonly nextRetryAt: string;
  readonly retryCount: number;
}

export interface MetadataStoreService {
  readonly insert: (item: KevaItem) => Effect.Effect<void, KevaError>;
  readonly createUpload: (
    item: KevaItem,
    attempt: UploadAttempt,
    shareReservation?: ShareUploadReservation,
  ) => Effect.Effect<
    { readonly item: KevaItem; readonly attempt: UploadAttempt; readonly reused: boolean },
    KevaError
  >;
  readonly reserveShareUpload: (
    reservation: ShareUploadReservation,
  ) => Effect.Effect<void, KevaError>;
  readonly get: (tenantId: string, id: string) => Effect.Effect<KevaItem | null, KevaError>;
  readonly transition: (
    tenantId: string,
    id: string,
    from: ReadonlyArray<ItemStatus>,
    patch: ItemTransition,
    olderThan?: string,
  ) => Effect.Effect<boolean, KevaError>;
  readonly transitionWithEvent: (
    tenantId: string,
    id: string,
    from: ReadonlyArray<ItemStatus>,
    patch: ItemTransition,
    event: (item: KevaItem) => ItemEvent,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  // `previous` is the row read inside the update's critical section, so
  // callers can diff before/after accurately even when patches race.
  readonly patch: (
    tenantId: string,
    id: string,
    patch: ItemPatchInput,
    updatedAt: string,
    expectedRevision?: number,
  ) => Effect.Effect<ItemPatchResult | null, KevaError>;
  readonly patchWithEvent: (
    tenantId: string,
    id: string,
    patch: ItemPatchInput,
    updatedAt: string,
    expectedRevision: number | undefined,
    event: (previous: KevaItem, updated: KevaItem) => ItemEvent | null,
  ) => Effect.Effect<ItemPatchResult | null, KevaError>;
  readonly trash: (
    tenantId: string,
    id: string,
    deletedAt: string,
    event: (item: KevaItem) => ItemEvent,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  readonly restore: (
    tenantId: string,
    id: string,
    updatedAt: string,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  readonly beginPurge: (
    tenantId: string,
    id: string,
    updatedAt: string,
  ) => Effect.Effect<KevaItem | null, KevaError>;
  readonly listTrash: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<KevaItem & { readonly deletedAt: string }>, KevaError>;
  readonly remove: (
    tenantId: string,
    id: string,
    expectedStatus: ItemStatus,
  ) => Effect.Effect<boolean, KevaError>;
  readonly query: (tenantId: string, query: Query) => Effect.Effect<QueryResult, KevaError>;
  readonly usage: (tenantId: string) => Effect.Effect<UsageResult, KevaError>;
  readonly setQuota: (
    tenantId: string,
    quotaBytes: number | null,
  ) => Effect.Effect<void, KevaError>;
  // Count + byte-sum of a tenant's items attributed to one `source`, across
  // pending AND ready (pending counts so concurrent share initiates can't blow
  // a quota; reapPending releases abandoned holds after the pending TTL).
  // bytes = sum(size ?? declaredSize) — declared size is the honest floor before
  // confirm verifies actual bytes. Powers per-share upload quotas.
  readonly sourceUsage: (
    tenantId: string,
    source: string,
  ) => Effect.Effect<{ readonly count: number; readonly bytes: number }, KevaError>;
  readonly propertyKeys: (tenantId: string) => Effect.Effect<ReadonlyArray<string>, KevaError>;
  readonly propertyValues: (
    tenantId: string,
    key: string,
  ) => Effect.Effect<ReadonlyArray<PropertyScalar>, KevaError>;
  readonly propertySummary: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<PropertySummary>, KevaError>;
  readonly propertySuggestions: (
    tenantId: string,
    search: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<PropertySuggestion>, KevaError>;
  readonly listByStatus: (
    status: ItemStatus,
    limit: number,
    olderThan?: string,
  ) => Effect.Effect<ReadonlyArray<KevaItem>, KevaError>;
  // Ready items whose staging blob has not yet been recorded as purged. Drives
  // the durable staging-cleanup backstop; each swept item is then marked with
  // `markStagingCleaned` so the job makes progress instead of re-scanning.
  readonly listUploadAttemptsForItem: (
    tenantId: string,
    itemId: string,
  ) => Effect.Effect<ReadonlyArray<UploadAttempt>, KevaError>;
  readonly listUploadAttemptsForCleanup: (
    limit: number,
    eligibleAt: string,
  ) => Effect.Effect<ReadonlyArray<UploadAttempt>, KevaError>;
  readonly updateUploadAttempt: (
    id: string,
    patch: Partial<Pick<UploadAttempt, "state" | "observedEtag" | "nextRetryAt" | "retryCount">>,
  ) => Effect.Effect<void, KevaError>;
  readonly removeUploadAttempt: (id: string) => Effect.Effect<boolean, KevaError>;
  readonly appendEvent: (event: ItemEvent) => Effect.Effect<void, KevaError>;
  // Newest-first keyset pagination, same cursor format as `query`.
  readonly listEvents: (
    tenantId: string,
    itemId: string,
    options: ListEventsOptions,
  ) => Effect.Effect<ItemEventsResult, KevaError>;
}

export interface ShareUploadReservation {
  readonly grantId: string;
  readonly maxItems: number | null;
  readonly maxTotalBytes: number | null;
  readonly item: KevaItem;
}

export interface ListEventsOptions {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ItemPatchResult {
  readonly previous: KevaItem;
  readonly updated: KevaItem;
}

export class MetadataStore extends Context.Service<MetadataStore, MetadataStoreService>()(
  "@keva/core/MetadataStore",
) {}
