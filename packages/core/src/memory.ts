import {
  Conflict,
  ValidationError,
  decodeCursor,
  encodeCursor,
  FIELD_BY_KEY,
  Internal,
  QuotaExceeded,
  itemMatchesCondition,
  validateProperties,
  type ItemEvent,
  type PropertyKind,
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
  type ShareUploadReservation,
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
  const stagingCleaned = new Set<string>();
  const mapKey = (tenantId: string, id: string) => `${tenantId}\0${id}`;
  const shareUsage = (reservation: ShareUploadReservation) => {
    const source = `share:${reservation.grantId}`;
    let count = 0;
    let bytes = 0;
    for (const item of items.values()) {
      if (
        item.tenantId === reservation.item.tenantId &&
        item.source === source &&
        (item.status === "pending" || item.status === "ready")
      ) {
        count++;
        bytes += item.size ?? item.declaredSize;
      }
    }
    return { source, count, bytes };
  };
  const insert = (item: KevaItem) =>
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
    });

  return {
    insert,
    reserveShareUpload: (reservation) =>
      Effect.gen(function* () {
        const { source, count, bytes } = shareUsage(reservation);
        if (reservation.item.source !== source) {
          return yield* new Internal({ message: "Metadata write failed" });
        }
        if (
          (reservation.maxItems !== null && count + 1 > reservation.maxItems) ||
          (reservation.maxTotalBytes !== null &&
            bytes + reservation.item.declaredSize > reservation.maxTotalBytes)
        ) {
          return yield* new QuotaExceeded({ message: "Share storage limit reached" });
        }
        yield* insert(reservation.item);
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
    transitionWithEvent: (tenantId, id, from, patch, event) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || !from.includes(item.status)) return null;
        const updated = cloneItem({ ...item, ...patch });
        items.set(key, updated);
        events.push(structuredClone(event(updated)));
        return cloneItem(updated);
      }),
    patch: (tenantId, id, patch, updatedAt) =>
      Effect.gen(function* () {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || item.status !== "ready") return null;
        const properties = { ...item.properties, ...patch.set };
        for (const unset of patch.unset) delete properties[unset];
        if (validateProperties(properties) !== null) {
          return yield* new QuotaExceeded({ message: "Property limits exceeded" });
        }
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
    patchWithEvent: (tenantId, id, patch, updatedAt, event) =>
      Effect.gen(function* () {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || item.status !== "ready") return null;
        const properties = { ...item.properties, ...patch.set };
        for (const unset of patch.unset) delete properties[unset];
        if (validateProperties(properties) !== null) {
          return yield* new QuotaExceeded({ message: "Property limits exceeded" });
        }
        const updated: KevaItem = { ...item, properties, updatedAt };
        for (const [fieldKey, value] of Object.entries(patch.fields)) {
          const field = FIELD_BY_KEY.get(fieldKey);
          if (field) (updated as Record<string, unknown>)[field.itemField] = value;
        }
        const previous = cloneItem(item);
        const result = { previous, updated: cloneItem(updated) };
        items.set(key, cloneItem(updated));
        const nextEvent = event(result.previous, result.updated);
        if (nextEvent) events.push(structuredClone(nextEvent));
        return result;
      }),
    remove: (tenantId, id, expectedStatus) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const item = items.get(key);
        if (!item || item.status !== expectedStatus) return false;
        items.delete(key);
        stagingCleaned.delete(key);
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
      Effect.try({
        try: () => {
          const order = query.order ?? "created_at_asc";
          const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
          if (query.cursor && !cursor)
            throw new ValidationError({ message: "Invalid query cursor" });
          let rows = [...items.values()]
            .filter((item) => item.tenantId === tenantId && item.status === "ready")
            .filter((item) => matchesSearch(item, query.search))
            .filter((item) =>
              query.where.every((condition) => itemMatchesCondition(item, condition)),
            )
            .sort(compareCreated(order));
          if (cursor) {
            rows = rows.filter((item) => isAfterCursor(order, item, cursor));
          }
          const page = rows.slice(0, query.limit + 1);
          const hasMore = page.length > query.limit;
          const result = page.slice(0, query.limit).map(cloneItem);
          return {
            items: result,
            ...(hasMore && result.at(-1)
              ? { nextCursor: encodeCursor([result.at(-1)!.createdAt, result.at(-1)!.id]) }
              : {}),
          };
        },
        catch: (error) =>
          error instanceof ValidationError
            ? error
            : new Internal({ message: "Metadata query failed" }),
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
    propertySummary: (tenantId) =>
      Effect.sync(() => {
        const entries = new Map<
          string,
          { kinds: Set<PropertyKind>; values: Map<string, PropertyScalar> }
        >();
        for (const item of items.values()) {
          if (item.tenantId !== tenantId || item.status !== "ready") continue;
          for (const [key, value] of Object.entries(item.properties)) {
            let entry = entries.get(key);
            if (!entry) {
              entry = { kinds: new Set(), values: new Map() };
              entries.set(key, entry);
            }
            if (value === null) entry.kinds.add("tag");
            else if (Array.isArray(value)) entry.kinds.add("array");
            else if (isScalar(value)) {
              entry.kinds.add(typeof value as "string" | "number" | "boolean");
              entry.values.set(JSON.stringify(value), value);
            }
          }
        }
        return [...entries.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, SUGGESTION_KEY_LIMIT)
          .map(([key, entry]) => ({
            key,
            kinds: [...entry.kinds].sort(),
            values: [...entry.values.values()]
              .sort((a, b) => String(a).localeCompare(String(b)))
              .slice(0, SUGGESTION_VALUE_LIMIT),
          }));
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
    listStagingUncleaned: (limit) =>
      Effect.sync(() =>
        [...items.values()]
          .filter(
            (item) =>
              item.status === "ready" && !stagingCleaned.has(mapKey(item.tenantId, item.id)),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, limit)
          .map(cloneItem),
      ),
    markStagingCleaned: (tenantId, id) =>
      Effect.sync(() => {
        stagingCleaned.add(mapKey(tenantId, id));
      }),
    appendEvent: (event) =>
      Effect.sync(() => {
        events.push(structuredClone(event));
      }),
    listEvents: (tenantId, itemId, options) =>
      Effect.try({
        try: () => {
          const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
          if (options.cursor && !cursor)
            throw new ValidationError({ message: "Invalid query cursor" });
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
        },
        catch: (error) =>
          error instanceof ValidationError
            ? error
            : new Internal({ message: "Metadata query failed" }),
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
    put: (key, body, contentType, expectedSize) =>
      Effect.tryPromise({
        try: async () => {
          const reader = body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > expectedSize) throw new Error("Upload exceeds declared size");
            chunks.push(next.value);
          }
          if (size !== expectedSize) throw new Error("Upload size does not match declaration");
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          blobs.set(key, { bytes, contentType, etag: await hashBytes(bytes) });
        },
        catch: () => new ValidationError({ message: "Upload size does not match declaration" }),
      }),
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
