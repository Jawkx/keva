import {
  Conflict,
  FIELD_BY_KEY,
  Internal,
  type PropertyValue,
  type KevaItem,
  type QueryCondition,
} from "@keva/schema";
import { Effect, Layer } from "effect";
import {
  BlobStore,
  type BlobStoreService,
  MetadataStore,
  type MetadataStoreService,
} from "./services.js";

interface MemoryBlob {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
}

const cloneItem = (item: KevaItem): KevaItem =>
  structuredClone(item);

const valueAt = (
  item: KevaItem,
  key: string,
): { exists: boolean; value: PropertyValue | string | number | null } => {
  // Declared fields (id, name, system.*) read from their column accessor;
  // every other key resolves against the property blob.
  const field = FIELD_BY_KEY.get(key);
  if (field) {
    const value = item[field.itemField] as
      | PropertyValue
      | string
      | number
      | null;
    return { exists: true, value: value ?? null };
  }
  return Object.prototype.hasOwnProperty.call(item.properties, key)
    ? { exists: true, value: item.properties[key] ?? null }
    : { exists: false, value: null };
};

const equals = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && Object.is(left, right);

const matches = (item: KevaItem, condition: QueryCondition): boolean => {
  const candidate = valueAt(item, condition.key);
  if (condition.op === "exists") return candidate.exists;
  if (!candidate.exists) return false;
  const operand = condition.value;
  switch (condition.op) {
    case "eq":
      return equals(candidate.value, operand);
    case "neq":
      return !equals(candidate.value, operand);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (
        typeof candidate.value !== typeof operand ||
        (typeof candidate.value !== "number" &&
          typeof candidate.value !== "string")
      ) return false;
      const left = candidate.value;
      const right = operand as number | string;
      if (typeof left === "number" && typeof right === "number") {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      if (typeof left === "string" && typeof right === "string") {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      return false;
    }
    case "contains":
      if (typeof candidate.value === "string" && typeof operand === "string") {
        return candidate.value.includes(operand);
      }
      return Array.isArray(candidate.value) &&
        candidate.value.some((item) => equals(item, operand));
  }
};

const matchesSearch = (
  item: KevaItem,
  search: string | undefined,
): boolean => {
  const term = search?.trim().toLowerCase();
  if (!term) return true;
  return (
    item.name.toLowerCase().includes(term) ||
    item.contentType.toLowerCase().includes(term)
  );
};

const encodeCursor = (item: KevaItem): string =>
  btoa(JSON.stringify([item.createdAt, item.id]));

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

export const makeMemoryMetadataStore = (): MetadataStoreService => {
  const items = new Map<string, KevaItem>();
  const mapKey = (tenantId: string, id: string) => `${tenantId}\0${id}`;

  return {
    insert: (item) =>
      Effect.gen(function* () {
        const key = mapKey(item.tenantId, item.id);
        if (items.has(key)) {
          return yield* new Internal({ message: "Metadata write failed" });
        }
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
        ) return false;
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
        return cloneItem(updated);
      }),
    remove: (tenantId, id, expectedStatus) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        if (items.get(key)?.status !== expectedStatus) return false;
        return items.delete(key);
      }),
    query: (tenantId, query) =>
      Effect.sync(() => {
        const cursor = query.cursor ? decodeCursor(query.cursor) : null;
        let rows = [...items.values()]
          .filter((item) => item.tenantId === tenantId && item.status === "ready")
          .filter((item) => matchesSearch(item, query.search))
          .filter((item) => query.where.every((condition) => matches(item, condition)))
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? a.id.localeCompare(b.id)
              : a.createdAt.localeCompare(b.createdAt)
          );
        if (cursor) {
          rows = rows.filter(
            (item) =>
              item.createdAt > cursor[0] ||
              (item.createdAt === cursor[0] && item.id > cursor[1]),
          );
        }
        const page = rows.slice(0, query.limit + 1);
        const hasMore = page.length > query.limit;
        const result = page.slice(0, query.limit).map(cloneItem);
        return {
          items: result,
          ...(hasMore && result.at(-1)
            ? { nextCursor: encodeCursor(result.at(-1)!) }
            : {}),
        };
      }),
    listByStatus: (status, limit, olderThan) =>
      Effect.sync(() =>
        [...items.values()]
          .filter(
            (item) =>
              item.status === status &&
              (olderThan === undefined || item.createdAt < olderThan),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, limit)
          .map(cloneItem)
      ),
  };
};

export const MemoryMetadataStoreLive = Layer.sync(
  MetadataStore,
  makeMemoryMetadataStore,
);

export interface MemoryBlobStoreOptions {
  readonly baseUrl?: string;
  readonly uploadTtlSeconds?: number;
  readonly downloadTtlSeconds?: number;
}

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const makeMemoryBlobStore = (
  options: MemoryBlobStoreOptions = {},
): BlobStoreService => {
  const blobs = new Map<string, MemoryBlob>();
  const grants = new Map<string, {
    readonly key: string;
    readonly method: "PUT" | "GET";
    readonly size?: number;
    readonly contentType?: string;
    readonly expiresAt: number;
  }>();
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
        headers: method === "PUT"
          ? {
              "content-length": String(size ?? 0),
              "content-type": contentType ?? "application/octet-stream",
            }
          : {},
      };
    });

  return {
    presignUpload: (key, size, contentType) =>
      presign(
        key,
        "PUT",
        options.uploadTtlSeconds ?? 900,
        size,
        contentType,
      ),
    presignDownload: (key) =>
      presign(key, "GET", options.downloadTtlSeconds ?? 300),
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
        if (
          !grant ||
          grant.key !== key ||
          grant.method !== "GET" ||
          grant.expiresAt < Date.now()
        ) {
          return yield* new Conflict({ message: "Invalid download grant" });
        }
        const blob = blobs.get(key);
        return blob
          ? { bytes: blob.bytes.slice(), contentType: blob.contentType }
          : null;
      }),
  };
};

export const MemoryBlobStoreLive = (
  options: MemoryBlobStoreOptions = {},
): Layer.Layer<BlobStore> =>
  Layer.sync(BlobStore, () => makeMemoryBlobStore(options));
