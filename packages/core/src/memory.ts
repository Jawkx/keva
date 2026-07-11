import {
  Conflict,
  FIELD_BY_KEY,
  Internal,
  QuotaExceeded,
  itemMatchesCondition,
  type ItemEvent,
  type PropertyScalar,
  type PropertyValue,
  type KevaItem,
  type QueryOrder,
} from "@keva/schema";
import { Effect, Layer } from "effect";
import {
  BlobStore,
  type BlobStoreService,
  MetadataStore,
  type MetadataStoreService,
  DEFAULT_STORAGE_QUOTA_BYTES,
  SUGGESTION_KEY_LIMIT,
  SUGGESTION_VALUE_LIMIT,
} from "./services.js";

interface MemoryBlob {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
}

const cloneItem = (item: KevaItem): KevaItem => structuredClone(item);

const isScalar = (value: PropertyValue | undefined): value is PropertyScalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const matchesSearch = (item: KevaItem, search: string | undefined): boolean => {
  const term = search?.trim().toLowerCase();
  if (!term) return true;
  return item.name.toLowerCase().includes(term) || item.contentType.toLowerCase().includes(term);
};

const encodeCursor = (item: KevaItem): string => btoa(JSON.stringify([item.createdAt, item.id]));

const decodeCursor = (cursor: string): readonly [string, string] | null => {
  try {
    const value = JSON.parse(atob(cursor)) as unknown;
    return Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
      ? [value[0], value[1]]
      : null;
  } catch {
    return null;
  }
};

const compareCreated =
  (order: QueryOrder) =>
  (a: KevaItem, b: KevaItem): number => {
    const direction = order === "created_at_desc" ? -1 : 1;
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    return (byCreatedAt === 0 ? a.id.localeCompare(b.id) : byCreatedAt) * direction;
  };

const isAfterCursor = (order: QueryOrder, item: KevaItem, cursor: readonly [string, string]) =>
  order === "created_at_desc"
    ? item.createdAt < cursor[0] || (item.createdAt === cursor[0] && item.id < cursor[1])
    : item.createdAt > cursor[0] || (item.createdAt === cursor[0] && item.id > cursor[1]);

const compareEventsDesc = (a: ItemEvent, b: ItemEvent): number => {
  const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
  return byCreatedAt === 0 ? b.id.localeCompare(a.id) : byCreatedAt;
};

const encodeEventCursor = (event: ItemEvent): string =>
  btoa(JSON.stringify([event.createdAt, event.id]));

export const makeMemoryMetadataStore = (): MetadataStoreService => {
  const items = new Map<string, KevaItem>();
  const events: ItemEvent[] = [];
  const usageByTenant = new Map<string, { usedBytes: number; quotaBytes: number | null }>();
  const mapKey = (tenantId: string, id: string) => `${tenantId}\0${id}`;

  return {
    insert: (item) =>
      Effect.gen(function* () {
        const key = mapKey(item.tenantId, item.id);
        if (items.has(key)) {
          return yield* new Internal({ message: "Metadata write failed" });
        }
        const usage = usageByTenant.get(item.tenantId) ?? {
          usedBytes: 0,
          quotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
        };
        if (usage.quotaBytes !== null && usage.usedBytes + item.declaredSize > usage.quotaBytes) {
          return yield* new QuotaExceeded({ message: "Storage limit reached" });
        }
        usageByTenant.set(item.tenantId, {
          ...usage,
          usedBytes: usage.usedBytes + item.declaredSize,
        });
        items.set(key, cloneItem(item));
      }),
    get: (tenantId, id) =>
      Effect.sync(() => {
        const item = items.get(mapKey(tenantId, id));
        return item ? cloneItem(item) : null;
      }),
    transition: (tenantId, id, from, patch, olderThan) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (
          !item ||
          !from.includes(item.status) ||
          (olderThan !== undefined && item.createdAt >= olderThan)
        )
          return false;
        items.set(key, cloneItem({ ...item, ...patch }));
        return true;
      }),
    patch: (tenantId, id, patch, updatedAt) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || item.status !== "ready") return null;
        const properties = { ...item.properties, ...patch.set };
        for (const unset of patch.unset) delete properties[unset];
        const updated: KevaItem = { ...item, properties, updatedAt };
        // Map each routed field key to its in-memory accessor. Cast is needed
        // because the registry types `itemField` as the full key union.
        for (const [fieldKey, value] of Object.entries(patch.fields)) {
          const field = FIELD_BY_KEY.get(fieldKey);
          if (field) {
            (updated as Record<string, unknown>)[field.itemField] = value;
          }
        }
        items.set(key, cloneItem(updated));
        return { previous: cloneItem(item), updated: cloneItem(updated) };
      }),
    remove: (tenantId, id, expectedStatus) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || item.status !== expectedStatus) return false;
        items.delete(key);
        const usage = usageByTenant.get(tenantId);
        if (usage) {
          usageByTenant.set(tenantId, {
            ...usage,
            usedBytes: Math.max(0, usage.usedBytes - (item.size ?? item.declaredSize)),
          });
        }
        return true;
      }),
    query: (tenantId, query) =>
      Effect.sync(() => {
        const order = query.order ?? "created_at_asc";
        const cursor = query.cursor ? decodeCursor(query.cursor) : null;
        let rows = [...items.values()]
          .filter((item) => item.tenantId === tenantId && item.status === "ready")
          .filter((item) => matchesSearch(item, query.search))
          .filter((item) => query.where.every((condition) => itemMatchesCondition(item, condition)))
          .sort(compareCreated(order));
        if (cursor) {
          rows = rows.filter((item) => isAfterCursor(order, item, cursor));
        }
        const page = rows.slice(0, query.limit + 1);
        const hasMore = page.length > query.limit;
        const result = page.slice(0, query.limit).map(cloneItem);
        return {
          items: result,
          ...(hasMore && result.at(-1) ? { nextCursor: encodeCursor(result.at(-1)!) } : {}),
        };
      }),
    usage: (tenantId) =>
      Effect.sync(() => {
        let itemCount = 0;
        let totalBytes = 0;
        const byType = new Map<string, { count: number; bytes: number }>();
        for (const item of items.values()) {
          if (item.tenantId !== tenantId || item.status !== "ready") continue;
          const bytes = item.size ?? 0;
          itemCount += 1;
          totalBytes += bytes;
          const entry = byType.get(item.contentType) ?? { count: 0, bytes: 0 };
          entry.count += 1;
          entry.bytes += bytes;
          byType.set(item.contentType, entry);
        }
        const quotaBytes = usageByTenant.get(tenantId)?.quotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES;
        const accountedBytes = usageByTenant.get(tenantId)?.usedBytes ?? totalBytes;
        return {
          itemCount,
          totalBytes,
          quotaBytes,
          remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - accountedBytes),
          // Match the postgres store's ordering for store-equivalence.
          byType: [...byType.entries()]
            .map(([contentType, value]) => ({ contentType, ...value }))
            .sort((a, b) => b.bytes - a.bytes || a.contentType.localeCompare(b.contentType)),
        };
      }),
    setQuota: (tenantId, quotaBytes) =>
      Effect.sync(() => {
        const usage = usageByTenant.get(tenantId) ?? { usedBytes: 0, quotaBytes };
        usageByTenant.set(tenantId, { ...usage, quotaBytes });
      }),
    sourceUsage: (tenantId, source) =>
      Effect.sync(() => {
        let count = 0;
        let bytes = 0;
        for (const item of items.values()) {
          if (
            item.tenantId !== tenantId ||
            item.source !== source ||
            (item.status !== "pending" && item.status !== "ready")
          )
            continue;
          count += 1;
          bytes += item.size ?? item.declaredSize;
        }
        return { count, bytes };
      }),
    propertyKeys: (tenantId) =>
      Effect.sync(() => {
        const keys = new Set<string>();
        for (const item of items.values()) {
          if (item.tenantId !== tenantId || item.status !== "ready") continue;
          for (const key of Object.keys(item.properties)) keys.add(key);
        }
        return [...keys].sort().slice(0, SUGGESTION_KEY_LIMIT);
      }),
    propertyValues: (tenantId, key) =>
      Effect.sync(() => {
        // Dedup by JSON so 1 (number) and "1" (string) stay distinct.
        const seen = new Map<string, PropertyScalar>();
        for (const item of items.values()) {
          if (item.tenantId !== tenantId || item.status !== "ready") continue;
          const value = item.properties[key];
          if (isScalar(value)) seen.set(JSON.stringify(value), value);
        }
        return [...seen.values()]
          .sort((a, b) => String(a).localeCompare(String(b)))
          .slice(0, SUGGESTION_VALUE_LIMIT);
      }),
    listByStatus: (status, limit, olderThan) =>
      Effect.sync(() =>
        [...items.values()]
          .filter(
            (item) =>
              item.status === status && (olderThan === undefined || item.createdAt < olderThan),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, limit)
          .map(cloneItem),
      ),
    appendEvent: (event) =>
      Effect.sync(() => {
        events.push(structuredClone(event));
      }),
    listEvents: (tenantId, itemId, options) =>
      Effect.sync(() => {
        const cursor = options.cursor ? decodeCursor(options.cursor) : null;
        let rows = events
          .filter((event) => event.tenantId === tenantId && event.itemId === itemId)
          .sort(compareEventsDesc);
        if (cursor) {
          rows = rows.filter(
            (event) =>
              event.createdAt < cursor[0] ||
              (event.createdAt === cursor[0] && event.id < cursor[1]),
          );
        }
        const page = rows.slice(0, options.limit + 1);
        const hasMore = page.length > options.limit;
        const result = page.slice(0, options.limit).map((event) => structuredClone(event));
        return {
          events: result,
          ...(hasMore && result.at(-1) ? { nextCursor: encodeEventCursor(result.at(-1)!) } : {}),
        };
      }),
  };
};

export const MemoryMetadataStoreLive = Layer.sync(MetadataStore, makeMemoryMetadataStore);

export interface MemoryBlobStoreOptions {
  readonly baseUrl?: string;
  readonly uploadTtlSeconds?: number;
  readonly downloadTtlSeconds?: number;
}

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const makeMemoryBlobStore = (options: MemoryBlobStoreOptions = {}): BlobStoreService => {
  const blobs = new Map<string, MemoryBlob>();
  const grants = new Map<
    string,
    {
      readonly key: string;
      readonly method: "PUT" | "GET";
      readonly size?: number;
      readonly contentType?: string;
      readonly expiresAt: number;
    }
  >();
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:8787";

  const presign = (
    key: string,
    method: "PUT" | "GET",
    ttlSeconds: number,
    size?: number,
    contentType?: string,
  ) =>
    Effect.sync(() => {
      const token = crypto.randomUUID();
      const expiresAt = Date.now() + ttlSeconds * 1000;
      grants.set(token, {
        key,
        method,
        expiresAt,
        ...(size === undefined ? {} : { size }),
        ...(contentType === undefined ? {} : { contentType }),
      });
      return {
        url: `${baseUrl}/__dev/blobs/${encodeURIComponent(key)}?token=${token}`,
        expiresAt: new Date(expiresAt).toISOString(),
        headers:
          method === "PUT"
            ? {
                "content-type": contentType ?? "application/octet-stream",
              }
            : {},
      };
    });

  return {
    presignUpload: (key, size, contentType) =>
      presign(key, "PUT", options.uploadTtlSeconds ?? 900, size, contentType),
    presignDownload: (key) => presign(key, "GET", options.downloadTtlSeconds ?? 300),
    head: (key) =>
      Effect.sync(() => {
        const blob = blobs.get(key);
        return blob
          ? {
              size: blob.bytes.byteLength,
              etag: blob.etag,
              contentType: blob.contentType,
            }
          : null;
      }),
    copy: (sourceKey, destinationKey) =>
      Effect.gen(function* () {
        const source = blobs.get(sourceKey);
        if (!source) {
          return yield* new Conflict({ message: "Staged upload does not exist" });
        }
        blobs.set(destinationKey, {
          ...source,
          bytes: source.bytes.slice(),
        });
      }),
    delete: (key) => Effect.sync(() => void blobs.delete(key)),
    devPut: (key, bytes, contentType, token) =>
      Effect.gen(function* () {
        const grant = grants.get(token);
        if (
          !grant ||
          grant.key !== key ||
          grant.method !== "PUT" ||
          grant.expiresAt < Date.now() ||
          grant.size !== bytes.byteLength ||
          grant.contentType !== contentType
        ) {
          return yield* new Conflict({ message: "Invalid upload grant" });
        }
        const etag = yield* Effect.promise(() => hashBytes(bytes));
        blobs.set(key, {
          bytes: bytes.slice(),
          contentType,
          etag,
        });
      }),
    devGet: (key, token) =>
      Effect.gen(function* () {
        const grant = grants.get(token);
        if (!grant || grant.key !== key || grant.method !== "GET" || grant.expiresAt < Date.now()) {
          return yield* new Conflict({ message: "Invalid download grant" });
        }
        const blob = blobs.get(key);
        return blob ? { bytes: blob.bytes.slice(), contentType: blob.contentType } : null;
      }),
  };
};

export const MemoryBlobStoreLive = (options: MemoryBlobStoreOptions = {}): Layer.Layer<BlobStore> =>
  Layer.sync(BlobStore, () => makeMemoryBlobStore(options));
