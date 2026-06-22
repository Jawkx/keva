import {
  Conflict,
  Internal,
  type AttributeValue,
  type KevaObject,
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

const cloneObject = (object: KevaObject): KevaObject =>
  structuredClone(object);

const valueAt = (
  object: KevaObject,
  key: string,
): { exists: boolean; value: AttributeValue | string | number | null } => {
  if (key === "id") return { exists: true, value: object.id };
  if (key === "name") return { exists: true, value: object.name };
  const system: Record<string, AttributeValue> = {
    "system.content_type": object.contentType,
    "system.size": object.size,
    "system.etag": object.etag,
    "system.checksum": object.checksum,
    "system.source": object.source,
    "system.status": object.status,
    "system.created_at": object.createdAt,
    "system.updated_at": object.updatedAt,
  };
  if (key in system) return { exists: true, value: system[key] ?? null };
  return Object.prototype.hasOwnProperty.call(object.attributes, key)
    ? { exists: true, value: object.attributes[key] ?? null }
    : { exists: false, value: null };
};

const equals = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && Object.is(left, right);

const matches = (object: KevaObject, condition: QueryCondition): boolean => {
  const candidate = valueAt(object, condition.key);
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

const encodeCursor = (object: KevaObject): string =>
  btoa(JSON.stringify([object.createdAt, object.id]));

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
  const objects = new Map<string, KevaObject>();
  const mapKey = (tenantId: string, id: string) => `${tenantId}\0${id}`;

  return {
    insert: (object) =>
      Effect.gen(function* () {
        const key = mapKey(object.tenantId, object.id);
        if (objects.has(key)) {
          return yield* new Internal({ message: "Metadata write failed" });
        }
        objects.set(key, cloneObject(object));
      }),
    get: (tenantId, id) =>
      Effect.sync(() => {
        const object = objects.get(mapKey(tenantId, id));
        return object ? cloneObject(object) : null;
      }),
    transition: (tenantId, id, from, patch, olderThan) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const object = objects.get(key);
        if (
          !object ||
          !from.includes(object.status) ||
          (olderThan !== undefined && object.createdAt >= olderThan)
        ) return false;
        objects.set(key, cloneObject({ ...object, ...patch }));
        return true;
      }),
    patchAttributes: (tenantId, id, patch, updatedAt) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        const object = objects.get(key);
        if (!object || object.status !== "ready") return null;
        const attributes = { ...object.attributes, ...patch.set };
        for (const unset of patch.unset) delete attributes[unset];
        const updated = { ...object, attributes, updatedAt };
        objects.set(key, cloneObject(updated));
        return cloneObject(updated);
      }),
    remove: (tenantId, id, expectedStatus) =>
      Effect.sync(() => {
        const key = mapKey(tenantId, id);
        if (objects.get(key)?.status !== expectedStatus) return false;
        return objects.delete(key);
      }),
    query: (tenantId, query) =>
      Effect.sync(() => {
        const cursor = query.cursor ? decodeCursor(query.cursor) : null;
        let rows = [...objects.values()]
          .filter((object) => object.tenantId === tenantId && object.status === "ready")
          .filter((object) => query.where.every((condition) => matches(object, condition)))
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? a.id.localeCompare(b.id)
              : a.createdAt.localeCompare(b.createdAt)
          );
        if (cursor) {
          rows = rows.filter(
            (object) =>
              object.createdAt > cursor[0] ||
              (object.createdAt === cursor[0] && object.id > cursor[1]),
          );
        }
        const page = rows.slice(0, query.limit + 1);
        const hasMore = page.length > query.limit;
        const result = page.slice(0, query.limit).map(cloneObject);
        return {
          objects: result,
          ...(hasMore && result.at(-1)
            ? { nextCursor: encodeCursor(result.at(-1)!) }
            : {}),
        };
      }),
    listByStatus: (status, limit, olderThan) =>
      Effect.sync(() =>
        [...objects.values()]
          .filter(
            (object) =>
              object.status === status &&
              (olderThan === undefined || object.createdAt < olderThan),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, limit)
          .map(cloneObject)
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
