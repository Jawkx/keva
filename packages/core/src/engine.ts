import {
  ATTRIBUTE_LIMITS,
  Conflict,
  Forbidden,
  NotFound,
  QuotaExceeded,
  ValidationError,
  type AttributePatch,
  type InitiateUpload,
  type KevaObject,
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

const readyOrNotFound = (object: KevaObject | null) =>
  object?.status === "ready"
    ? Effect.succeed(object)
    : Effect.fail(new NotFound({ message: "Object not found" }));

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
      const object: KevaObject = {
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
        storageKey: `objects/${principal.tenantId}/${id}`,
        stagingKey: `staging/${principal.tenantId}/${id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        attributes: input.attributes,
      };
      yield* metadata.insert(object);
      const upload = yield* blobs.presignUpload(
        object.stagingKey,
        input.size,
        input.contentType,
      );
      return {
        object,
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
      const object = yield* metadata.get(principal.tenantId, id);
      if (!object) return yield* new NotFound({ message: "Object not found" });
      if (object.status === "ready") return object;
      if (object.status !== "pending") {
        return yield* new Conflict({ message: "Upload is no longer pending" });
      }
      const head = yield* blobs.head(object.stagingKey);
      if (!head) {
        return yield* new Conflict({ message: "Staged upload does not exist" });
      }
      if (head.size !== object.declaredSize) {
        return yield* new ValidationError({
          message: `Uploaded size ${head.size} does not match declared size ${object.declaredSize}`,
        });
      }
      yield* blobs.copy(object.stagingKey, object.storageKey);
      const transitioned = yield* metadata.transition(
        principal.tenantId,
        id,
        ["pending"],
        {
          status: "ready",
          size: head.size,
          etag: head.etag,
          contentType: head.contentType ?? object.contentType,
          updatedAt: now(),
        },
      );
      if (!transitioned) {
        const current = yield* metadata.get(principal.tenantId, id);
        if (current?.status === "ready") return current;
        return yield* new Conflict({ message: "Upload expired while confirming" });
      }
      yield* blobs.delete(object.stagingKey).pipe(Effect.ignore);
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
      const object = yield* readyOrNotFound(
        yield* metadata.get(principal.tenantId, id),
      );
      const request = yield* blobs.presignDownload(object.storageKey);
      return { url: request.url, expiresAt: request.expiresAt };
    }),

  patchAttributes: (id: string, patch: AttributePatch) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const current = yield* readyOrNotFound(
        yield* metadata.get(principal.tenantId, id),
      );
      const merged = { ...current.attributes, ...patch.set };
      for (const key of patch.unset) delete merged[key];
      // Re-check the *merged* result against every limit, not just the
      // incoming `set` (which Effect Schema already validated). Merging an
      // otherwise-valid patch into existing attributes can still push the
      // object past the per-object key count, per-value size, or total bytes.
      const encoder = new TextEncoder();
      const totalBytes = encoder.encode(JSON.stringify(merged)).byteLength;
      const valueExceedsLimit = (value: unknown): boolean =>
        (typeof value === "string" &&
          encoder.encode(value).byteLength > ATTRIBUTE_LIMITS.stringBytes) ||
        (Array.isArray(value) && value.length > ATTRIBUTE_LIMITS.arrayItems);
      if (
        Object.keys(merged).length > ATTRIBUTE_LIMITS.keys ||
        totalBytes > ATTRIBUTE_LIMITS.totalBytes ||
        Object.values(merged).some(valueExceedsLimit)
      ) {
        return yield* new QuotaExceeded({
          message: "Attribute limits exceeded",
        });
      }
      const updated = yield* metadata.patchAttributes(
        principal.tenantId,
        id,
        patch,
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
    for (const object of pending) {
      const claimed = yield* metadata.transition(
        object.tenantId,
        object.id,
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
    for (const object of deleting) {
      yield* blobs.delete(object.storageKey);
      yield* blobs.delete(object.stagingKey);
      const removed = yield* metadata.remove(
        object.tenantId,
        object.id,
        "deleting",
      );
      if (removed) swept++;
    }
    return swept;
  });
