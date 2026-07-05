import {
  PROPERTY_LIMITS,
  Conflict,
  Forbidden,
  NotFound,
  QuotaExceeded,
  ValidationError,
  itemMatchesCondition,
  routePatch,
  type ItemPatch,
  type InitiateUpload,
  type KevaItem,
  type Principal,
  type Query,
  type Scope,
  type ShareGrantContext,
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

// A share principal's grant context, or null for session/token principals. The
// engine keys share-scoped enforcement off the *presence of the context*, not
// the `via` discriminant alone.
const shareOf = (principal: Principal): ShareGrantContext | null =>
  principal.via === "share" ? (principal.share ?? null) : null;

// Mutations and tenant-wide reads a share may never perform, regardless of the
// scopes it holds. Checked before `requireScope` so the caller gets a
// share-specific 403 (e.g. a read+write share hitting patch/delete, or a read
// share hitting usage/property autocomplete).
const forbidShare = (principal: Principal, action: string): Effect.Effect<void, Forbidden> =>
  shareOf(principal)
    ? Effect.fail(new Forbidden({ message: `Shares cannot ${action}` }))
    : Effect.void;

// The `source` attributed to items uploaded through a share, used to attribute
// per-grant quota usage and to gate confirm/read back to the same grant.
const shareSource = (grantId: string): string => `share:${grantId}`;

// For point reads (get/download), a share only sees items matching every grant
// condition; a non-match is indistinguishable from a missing item (NotFound),
// so the endpoint can't be used to probe whether an out-of-grant item exists.
const shareVisible = (principal: Principal, item: KevaItem): Effect.Effect<KevaItem, NotFound> => {
  const share = shareOf(principal);
  return !share || share.conditions.every((condition) => itemMatchesCondition(item, condition))
    ? Effect.succeed(item)
    : Effect.fail(new NotFound({ message: "Item not found" }));
};

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
      const share = shareOf(principal);
      // `source: "share:{id}"` is the engine's private bookkeeping namespace. A
      // non-share caller setting it could inflate a grant's quota usage and make
      // its own item confirmable/readable through that grant — reject it.
      if (!share && input.source.startsWith("share:")) {
        return yield* new ValidationError({ message: "Source prefix 'share:' is reserved" });
      }
      let source = input.source;
      let properties = input.properties;
      if (share) {
        // A share upload carries no caller-chosen metadata: the only accepted
        // input is the SDK's schema defaults (source "upload", empty
        // properties). Anything else is a client bug or an escalation attempt
        // (e.g. stamping an item to match a different grant).
        if (input.source !== "upload" || Object.keys(input.properties).length > 0) {
          return yield* new ValidationError({
            message: "Share uploads cannot set source or properties",
          });
        }
        source = shareSource(share.grantId);
        properties = share.writeStamp ?? {};
        const limits = share.limits;
        if (limits) {
          if (limits.maxItemBytes !== null && input.size > limits.maxItemBytes) {
            return yield* new QuotaExceeded({
              message: "Upload exceeds this share's per-file size limit",
            });
          }
          if (limits.maxItems !== null || limits.maxTotalBytes !== null) {
            const used = yield* metadata.sourceUsage(principal.tenantId, source);
            if (limits.maxItems !== null && used.count + 1 > limits.maxItems) {
              return yield* new QuotaExceeded({
                message: "This share's upload count limit has been reached",
              });
            }
            if (limits.maxTotalBytes !== null && used.bytes + input.size > limits.maxTotalBytes) {
              return yield* new QuotaExceeded({
                message: "This share's total upload size limit has been reached",
              });
            }
          }
        }
      }
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
        source,
        status: "pending",
        storageKey: `items/${principal.tenantId}/${id}`,
        stagingKey: `staging/${principal.tenantId}/${id}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        properties,
      };
      yield* metadata.insert(item);
      const upload = yield* blobs.presignUpload(item.stagingKey, input.size, input.contentType);
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
      // A share may only confirm an upload it initiated. Any other item —
      // including one from a different grant or a regular upload — is invisible
      // to it (NotFound, no existence oracle).
      const share = shareOf(principal);
      if (share && item.source !== shareSource(share.grantId)) {
        return yield* new NotFound({ message: "Item not found" });
      }
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
      const transitioned = yield* metadata.transition(principal.tenantId, id, ["pending"], {
        status: "ready",
        size: head.size,
        etag: head.etag,
        contentType: head.contentType ?? item.contentType,
        updatedAt: now(),
      });
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
      const item = yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id));
      return yield* shareVisible(principal, item);
    }),

  download: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const item = yield* shareVisible(
        principal,
        yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id)),
      );
      const request = yield* blobs.presignDownload(item.storageKey);
      return { url: request.url, expiresAt: request.expiresAt };
    }),

  patch: (id: string, patch: ItemPatch) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "modify items");
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const current = yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id));
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
      const updated = yield* metadata.patch(principal.tenantId, id, routed.routed, now());
      return yield* readyOrNotFound(updated);
    }),

  query: (query: Query) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      // A share visitor's query is narrowed by the grant conditions: they are
      // ANDed onto whatever the visitor asked for, so a visitor can only ever
      // filter further within the shared view, never widen it.
      const share = shareOf(principal);
      const scoped = share
        ? { ...query, where: [...query.where, ...share.conditions] }
        : query;
      return yield* metadata.query(principal.tenantId, scoped);
    }),

  usage: () =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "read usage");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* metadata.usage(principal.tenantId);
    }),

  propertyKeys: () =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "list property keys");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return { keys: yield* metadata.propertyKeys(principal.tenantId) };
    }),

  propertyValues: (key: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "list property values");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return { values: yield* metadata.propertyValues(principal.tenantId, key) };
    }),

  delete: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "delete items");
      yield* requireScope(principal, "delete");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const current = yield* metadata.get(principal.tenantId, id);
      if (!current) return;
      if (current.status !== "deleting") {
        const claimed = yield* metadata.transition(principal.tenantId, id, ["ready", "pending"], {
          status: "deleting",
          updatedAt: now(),
        });
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
    const cutoff = new Date(Date.now() - (options.pendingTtlMs ?? 60 * 60 * 1000)).toISOString();
    const pending = yield* metadata.listByStatus("pending", options.batchSize ?? 100, cutoff);
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
    const deleting = yield* metadata.listByStatus("deleting", options.batchSize ?? 100);
    let swept = 0;
    for (const item of deleting) {
      yield* blobs.delete(item.storageKey);
      yield* blobs.delete(item.stagingKey);
      const removed = yield* metadata.remove(item.tenantId, item.id, "deleting");
      if (removed) swept++;
    }
    return swept;
  });
