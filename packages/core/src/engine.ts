import {
  PROPERTY_LIMITS,
  Conflict,
  Forbidden,
  NotFound,
  QuotaExceeded,
  ValidationError,
  routePatch,
  type ItemPatch,
  type InitiateUpload,
  type KevaItem,
  type Principal,
  type Query,
  type Scope,
} from "@keva/schema";
import { Effect } from "effect";
import { BlobStore, MetadataStore } from "./services.js";

const now = (): string => new Date().toISOString();

const requireScope = (principal: Principal, scope: Scope) =>
  principal.scopes.includes(scope)
    ? Effect.void
    : Effect.fail(new Forbidden({ message: `Missing '${scope}' scope` }));

const readyOrNotFound = (item: KevaItem | null) =>
  item?.status === "ready"
    ? Effect.succeed(item)
    : Effect.fail(new NotFound({ message: "Item not found" }));

export const makeKevaEngine = (principal: Principal) => ({
  initiate: (input: InitiateUpload) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "write");
      if (input.size > 5 * 1024 * 1024 * 1024) {
        return yield* new QuotaExceeded({
          message: "Single uploads are limited to 5 GB",
        });
      }
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const id = crypto.randomUUID();
      const timestamp = now();
      const item: KevaItem = {
        id,
        tenantId: principal.tenantId,
        name: input.name,
        contentType: input.contentType,
        declaredSize: input.size,
        size: null,
        etag: null,
        checksum: null,
        source: input.source,
        status: "pending",
        storageKey: `items/${principal.tenantId}/${id}`,
        stagingKey: `staging/${principal.tenantId}/${id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        properties: input.properties,
      };
      yield* metadata.insert(item);
      const upload = yield* blobs.presignUpload(
        item.stagingKey,
        input.size,
        input.contentType,
      );
      return {
        item,
        uploadUrl: upload.url,
        expiresAt: upload.expiresAt,
        headers: { ...upload.headers },
      };
    }),

  confirm: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const item = yield* metadata.get(principal.tenantId, id);
      if (!item) return yield* new NotFound({ message: "Item not found" });
      if (item.status === "ready") return item;
      if (item.status !== "pending") {
        return yield* new Conflict({ message: "Upload is no longer pending" });
      }
      const head = yield* blobs.head(item.stagingKey);
      if (!head) {
        return yield* new Conflict({ message: "Staged upload does not exist" });
      }
      if (head.size !== item.declaredSize) {
        return yield* new ValidationError({
          message: `Uploaded size ${head.size} does not match declared size ${item.declaredSize}`,
        });
      }
      yield* blobs.copy(item.stagingKey, item.storageKey);
      const transitioned = yield* metadata.transition(
        principal.tenantId,
        id,
        ["pending"],
        {
          status: "ready",
          size: head.size,
          etag: head.etag,
          contentType: head.contentType ?? item.contentType,
          updatedAt: now(),
        },
      );
      if (!transitioned) {
        const current = yield* metadata.get(principal.tenantId, id);
        if (current?.status === "ready") return current;
        return yield* new Conflict({ message: "Upload expired while confirming" });
      }
      yield* blobs.delete(item.stagingKey).pipe(Effect.ignore);
      const confirmed = yield* metadata.get(principal.tenantId, id);
      return yield* readyOrNotFound(confirmed);
    }),

  get: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* readyOrNotFound(
        yield* metadata.get(principal.tenantId, id),
      );
    }),

  download: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const item = yield* readyOrNotFound(
        yield* metadata.get(principal.tenantId, id),
      );
      const request = yield* blobs.presignDownload(item.storageKey);
      return { url: request.url, expiresAt: request.expiresAt };
    }),

  patch: (id: string, patch: ItemPatch) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const current = yield* readyOrNotFound(
        yield* metadata.get(principal.tenantId, id),
      );
      // Route each key to its column (user-writable fields like `name`) or the
      // property blob, rejecting writes to system-owned or reserved keys.
      const routed = routePatch(patch.set, patch.unset);
      if (!routed.ok) {
        return yield* new ValidationError({
          message: `Cannot patch '${routed.error.key}': ${routed.error.reason}`,
        });
      }
      const merged = { ...current.properties, ...routed.routed.set };
      for (const key of routed.routed.unset) delete merged[key];
      // Re-check the *merged* result against every limit, not just the
      // incoming `set` (which Effect Schema already validated). Merging an
      // otherwise-valid patch into existing properties can still push the
      // item past the per-item key count, per-value size, or total bytes.
      const encoder = new TextEncoder();
      const totalBytes = encoder.encode(JSON.stringify(merged)).byteLength;
      const valueExceedsLimit = (value: unknown): boolean =>
        (typeof value === "string" &&
          encoder.encode(value).byteLength > PROPERTY_LIMITS.stringBytes) ||
        (Array.isArray(value) && value.length > PROPERTY_LIMITS.arrayItems);
      if (
        Object.keys(merged).length > PROPERTY_LIMITS.keys ||
        totalBytes > PROPERTY_LIMITS.totalBytes ||
        Object.values(merged).some(valueExceedsLimit)
      ) {
        return yield* new QuotaExceeded({
          message: "Property limits exceeded",
        });
      }
      const updated = yield* metadata.patch(
        principal.tenantId,
        id,
        routed.routed,
        now(),
      );
      return yield* readyOrNotFound(updated);
    }),

  query: (query: Query) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* metadata.query(principal.tenantId, query);
    }),

  delete: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "delete");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const current = yield* metadata.get(principal.tenantId, id);
      if (!current) return;
      if (current.status !== "deleting") {
        const claimed = yield* metadata.transition(
          principal.tenantId,
          id,
          ["ready", "pending"],
          { status: "deleting", updatedAt: now() },
        );
        if (!claimed) return;
      }
      yield* blobs.delete(current.storageKey);
      yield* blobs.delete(current.stagingKey);
      yield* metadata.remove(principal.tenantId, id, "deleting");
    }),
});

export interface LifecycleJobOptions {
  readonly batchSize?: number;
  readonly pendingTtlMs?: number;
}

export const reapPending = (options: LifecycleJobOptions = {}) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const cutoff = new Date(
      Date.now() - (options.pendingTtlMs ?? 60 * 60 * 1000),
    ).toISOString();
    const pending = yield* metadata.listByStatus(
      "pending",
      options.batchSize ?? 100,
      cutoff,
    );
    let reaped = 0;
    for (const item of pending) {
      const claimed = yield* metadata.transition(
        item.tenantId,
        item.id,
        ["pending"],
        { status: "deleting", updatedAt: now() },
        cutoff,
      );
      if (claimed) reaped++;
    }
    return reaped;
  });

export const sweepDeleting = (options: LifecycleJobOptions = {}) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const blobs = yield* BlobStore;
    const deleting = yield* metadata.listByStatus(
      "deleting",
      options.batchSize ?? 100,
    );
    let swept = 0;
    for (const item of deleting) {
      yield* blobs.delete(item.storageKey);
      yield* blobs.delete(item.stagingKey);
      const removed = yield* metadata.remove(
        item.tenantId,
        item.id,
        "deleting",
      );
      if (removed) swept++;
    }
    return swept;
  });
