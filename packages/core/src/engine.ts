import {
  Conflict,
  Forbidden,
  NotFound,
  QuotaExceeded,
  ValidationError,
  canonicalizeProperties,
  itemMatchesCondition,
  propertyValuesEqual,
  routePatch,
  type ItemEventAction,
  type ItemEventPayload,
  type BatchPatchItem,
  type BatchPatchResult,
  type ItemPatch,
  type InitiateUpload,
  type KevaItem,
  type Principal,
  type PropertyValue,
  type Query,
  type Scope,
  type ThumbnailUploadInput,
} from "@keva/schema";
import { Effect } from "effect";
import { BlobStore, MetadataStore } from "./services.js";

export type { LifecycleBatchResult, LifecycleJobOptions } from "./lifecycle.js";
export { reapPending, sweepDeleting, sweepStaging } from "./lifecycle.js";

const now = (): string => new Date().toISOString();

const requireScope = (principal: Principal, scope: Scope) =>
  principal.scopes.includes(scope)
    ? Effect.void
    : Effect.fail(new Forbidden({ message: `Missing '${scope}' scope` }));

const readyOrNotFound = (item: KevaItem | null) =>
  item?.status === "ready" && item.deletedAt === undefined
    ? Effect.succeed(item)
    : Effect.fail(new NotFound({ message: "Item not found" }));

const trashedReadyOrNotFound = (item: KevaItem | null) =>
  item?.status === "ready" && item.deletedAt !== undefined
    ? Effect.succeed(item as KevaItem & { readonly deletedAt: string })
    : Effect.fail(new NotFound({ message: "Item not found in trash" }));

const videoOrNotFound = (item: KevaItem, message = "Item not found") =>
  item.contentType.startsWith("video/")
    ? Effect.succeed(item)
    : Effect.fail(new NotFound({ message }));

const thumbnailContentTypes = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);
const thumbnailKey = (tenantId: string, itemId: string): string =>
  `thumbnails/${tenantId}/${itemId}`;

const downloadThumbnail = (tenantId: string, itemId: string) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore;
    const key = thumbnailKey(tenantId, itemId);
    const head = yield* blobs.head(key);
    if (
      !head ||
      !head.contentType ||
      !thumbnailContentTypes.has(head.contentType) ||
      head.size < 1 ||
      head.size > 1024 * 1024
    ) {
      return yield* new NotFound({ message: "Thumbnail not found" });
    }
    const request = yield* blobs.presignDownload(key);
    return { url: request.url, expiresAt: request.expiresAt };
  });

// A share principal's grant context, or null for session/token principals. The
// engine keys share-scoped enforcement off the *presence of the context*, not
// the `via` discriminant alone.
const shareOf = (principal: Principal) => (principal.via === "share" ? principal.share : null);

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

export const canDeleteOwnShareUpload = (principal: Principal, item: KevaItem): boolean => {
  const share = shareOf(principal);
  const identityId = share?.identityId;
  return Boolean(
    share?.allowOwnDelete &&
    principal.scopes.includes("write") &&
    identityId &&
    item.status === "ready" &&
    item.deletedAt === undefined &&
    item.source === shareSource(share.grantId) &&
    item.uploadedByUserId === identityId,
  );
};

const eventFor = (
  principal: Principal,
  item: KevaItem,
  action: ItemEventAction,
  payload: ItemEventPayload,
) => ({
  id: crypto.randomUUID(),
  tenantId: principal.tenantId,
  itemId: item.id,
  itemName: item.name,
  action,
  actor: principal.actor ?? null,
  payload,
  createdAt: now(),
});

const patchItem = (principal: Principal, id: string, patch: ItemPatch) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const routed = routePatch(patch.set, patch.unset);
    if (!routed.ok) {
      return yield* new ValidationError({
        message: `Cannot patch '${routed.error.key}': ${routed.error.reason}`,
      });
    }
    const patched = yield* metadata.patchWithEvent(
      principal.tenantId,
      id,
      {
        ...routed.routed,
        ...(patch.presentation === undefined ? {} : { presentation: patch.presentation }),
      },
      now(),
      patch.expectedRevision,
      (previous, updated) => {
        const changedSet: Record<string, PropertyValue> = {};
        const previousValues: Record<string, PropertyValue> = {};
        for (const [key, value] of Object.entries(updated.properties)) {
          if (propertyValuesEqual(previous.properties[key], value)) continue;
          changedSet[key] = value;
          if (key in previous.properties) previousValues[key] = previous.properties[key]!;
        }
        const removed = Object.keys(previous.properties).filter(
          (key) => !(key in updated.properties),
        );
        for (const key of removed) previousValues[key] = previous.properties[key]!;
        const nameChanged = previous.name !== updated.name;
        const propertiesChanged = Object.keys(changedSet).length > 0 || removed.length > 0;
        return nameChanged || propertiesChanged
          ? eventFor(principal, updated, "updated", {
              ...(nameChanged ? { name: { from: previous.name, to: updated.name } } : {}),
              ...(propertiesChanged
                ? {
                    properties: {
                      ...(Object.keys(changedSet).length > 0 ? { set: changedSet } : {}),
                      ...(Object.keys(previousValues).length > 0
                        ? { previous: previousValues }
                        : {}),
                      ...(removed.length > 0 ? { unset: removed } : {}),
                    },
                  }
                : {}),
            })
          : null;
      },
    );
    if (!patched) return yield* new NotFound({ message: "Item not found" });
    return patched.updated;
  });

export const makeKevaEngine = (principal: Principal) => ({
  initiate: (input: InitiateUpload, retryKey?: string) =>
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
      const limits = share?.limits;
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
        if (limits && limits.maxItemBytes !== null && input.size > limits.maxItemBytes) {
          return yield* new QuotaExceeded({
            message: "Upload exceeds this share's per-file size limit",
          });
        }
      }
      if (retryKey !== undefined && (retryKey.length === 0 || retryKey.length > 200)) {
        return yield* new ValidationError({
          message: "Retry-Key must contain 1 to 200 characters",
        });
      }
      const id = crypto.randomUUID();
      const attemptId = crypto.randomUUID();
      const timestamp = now();
      const item: KevaItem = {
        id,
        tenantId: principal.tenantId,
        name: input.name,
        contentType: input.contentType,
        declaredSize: input.size,
        size: null,
        etag: null,
        source,
        ...(share?.identityId ? { uploadedByUserId: share.identityId } : {}),
        status: "pending",
        storageKey: `items/${principal.tenantId}/${id}`,
        stagingKey: `staging/${principal.tenantId}/${attemptId}`,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        properties: canonicalizeProperties(properties),
      };
      const upload = yield* blobs.presignUpload(item.stagingKey, input.size, input.contentType);
      const requestHash = JSON.stringify({
        name: input.name,
        contentType: input.contentType,
        size: input.size,
        source,
        uploadedByUserId: item.uploadedByUserId ?? null,
        properties: canonicalizeProperties(properties),
      });
      const created = yield* metadata.createUpload(
        item,
        {
          id: attemptId,
          tenantId: principal.tenantId,
          itemId: id,
          retryKey: retryKey ?? null,
          requestHash: retryKey ? requestHash : null,
          stagingKey: item.stagingKey,
          storageKey: item.storageKey,
          uploadUrl: upload.url,
          uploadHeaders: upload.headers,
          expectedSize: input.size,
          expiresAt: upload.expiresAt,
          state: "pending",
          observedEtag: null,
          cleanupAfter: upload.expiresAt,
          nextRetryAt: upload.expiresAt,
          retryCount: 0,
        },
        share && limits && (limits.maxItems !== null || limits.maxTotalBytes !== null)
          ? {
              grantId: share.grantId,
              maxItems: limits.maxItems,
              maxTotalBytes: limits.maxTotalBytes,
              item,
            }
          : undefined,
      );
      return {
        item: created.item,
        uploadUrl: created.attempt.uploadUrl,
        expiresAt: created.attempt.expiresAt,
        headers: { ...created.attempt.uploadHeaders },
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
      if (item.status === "ready") return yield* readyOrNotFound(item);
      if (item.status !== "pending" && item.status !== "confirming") {
        return yield* new Conflict({ message: "Upload is no longer pending" });
      }
      const attempts = yield* metadata.listUploadAttemptsForItem(principal.tenantId, id);
      const attempt = attempts.find((candidate) => candidate.stagingKey === item.stagingKey);
      if (!attempt) return yield* new Conflict({ message: "Upload attempt does not exist" });
      const staged = yield* blobs.head(item.stagingKey);
      if (!staged && item.status === "pending") {
        return yield* new Conflict({ message: "Staged upload does not exist" });
      }
      if (staged && staged.size !== item.declaredSize) {
        return yield* new ValidationError({
          message: `Uploaded size ${staged.size} does not match declared size ${item.declaredSize}`,
        });
      }
      if (item.status === "pending") {
        const claimed = yield* metadata.transition(principal.tenantId, id, ["pending"], {
          status: "confirming",
          updatedAt: now(),
        });
        if (!claimed) return yield* new Conflict({ message: "Upload changed while confirming" });
      }
      if (staged) {
        yield* metadata.updateUploadAttempt(attempt.id, {
          state: "confirming",
          observedEtag: staged.etag,
        });
        yield* blobs.copy(item.stagingKey, item.storageKey, staged.etag);
      }
      const final = yield* blobs.head(item.storageKey);
      const expectedEtag = staged?.etag ?? attempt.observedEtag;
      if (
        !final ||
        final.size !== item.declaredSize ||
        (expectedEtag !== null && final.etag !== expectedEtag)
      ) {
        return yield* new Conflict({ message: "Final upload verification failed" });
      }
      const confirmed = yield* metadata.transitionWithEvent(
        principal.tenantId,
        id,
        ["confirming"],
        {
          status: "ready",
          size: final.size,
          etag: final.etag,
          contentType: final.contentType ?? item.contentType,
          updatedAt: now(),
        },
        (updated) =>
          eventFor(principal, updated, "uploaded", {
            size: updated.size,
            contentType: updated.contentType,
            source: updated.source,
          }),
      );
      if (!confirmed) {
        const current = yield* metadata.get(principal.tenantId, id);
        if (current?.status === "ready") return current;
        yield* blobs.delete(item.storageKey);
        return yield* new Conflict({ message: "Upload expired while confirming" });
      }
      yield* metadata.updateUploadAttempt(attempt.id, { state: "confirmed" });
      yield* blobs.delete(item.stagingKey).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            JSON.stringify({
              event: "lifecycle.staging_cleanup.failed",
              tenantId: principal.tenantId,
              itemId: id,
              errorTag: error._tag,
            }),
          ),
        ),
      );
      return confirmed;
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

  initiateThumbnail: (id: string, input: ThumbnailUploadInput) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "upload thumbnails");
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      yield* videoOrNotFound(yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id)));
      const request = yield* blobs.presignUpload(
        thumbnailKey(principal.tenantId, id),
        input.size,
        input.contentType,
      );
      return { url: request.url, expiresAt: request.expiresAt, headers: request.headers };
    }),

  downloadThumbnail: (id: string) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      const item = yield* shareVisible(
        principal,
        yield* videoOrNotFound(yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id))),
      );
      return yield* downloadThumbnail(item.tenantId, item.id);
    }),

  deleteThumbnail: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "delete thumbnails");
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      yield* videoOrNotFound(yield* readyOrNotFound(yield* metadata.get(principal.tenantId, id)));
      yield* blobs.delete(thumbnailKey(principal.tenantId, id));
    }),

  patch: (id: string, patch: ItemPatch) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "modify items");
      yield* requireScope(principal, "write");
      return yield* patchItem(principal, id, patch);
    }),

  patchMany: (items: readonly BatchPatchItem[], patch: Pick<ItemPatch, "set" | "unset">) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "modify items");
      yield* requireScope(principal, "write");
      const results = yield* Effect.forEach(
        items,
        ({ id, expectedRevision }) =>
          patchItem(principal, id, { ...patch, expectedRevision }).pipe(
            Effect.map((item) => ({
              status: "updated" as const,
              id,
              revision: item.revision,
            })),
            Effect.catchAll((error) => Effect.succeed({ status: "failed" as const, id, error })),
          ),
        { concurrency: 8 },
      );
      return {
        updated: results
          .filter((result) => result.status === "updated")
          .map(({ id, revision }) => ({ id, revision })),
        failed: results
          .filter((result) => result.status === "failed")
          .map(({ id, error }) => ({ id, error })),
      } satisfies BatchPatchResult;
    }),

  // Events outlive deletion, so this does not require the item to exist.
  // Shares never see history — it carries actor names and property values
  // beyond the grant's conditions.
  events: (id: string, options?: { readonly limit?: number; readonly cursor?: string }) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "read item history");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* metadata.listEvents(principal.tenantId, id, {
        limit: options?.limit ?? 50,
        ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
      });
    }),

  query: (query: Query) =>
    Effect.gen(function* () {
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      // A share visitor's query is narrowed by the grant conditions: they are
      // ANDed onto whatever the visitor asked for, so a visitor can only ever
      // filter further within the shared view, never widen it.
      const share = shareOf(principal);
      const scoped = share ? { ...query, where: [...query.where, ...share.conditions] } : query;
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

  propertySummary: () =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "summarize properties");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return { entries: yield* metadata.propertySummary(principal.tenantId) };
    }),

  propertySuggestions: (search: string, limit: number) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "search properties");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return {
        entries: yield* metadata.propertySuggestions(principal.tenantId, search, limit),
      };
    }),

  listTrash: () =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "list trash");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* metadata.listTrash(principal.tenantId);
    }),

  getTrash: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "read trash");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      return yield* trashedReadyOrNotFound(yield* metadata.get(principal.tenantId, id));
    }),

  downloadTrash: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "read trash");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const item = yield* trashedReadyOrNotFound(yield* metadata.get(principal.tenantId, id));
      const request = yield* blobs.presignDownload(item.storageKey);
      return { url: request.url, expiresAt: request.expiresAt };
    }),

  downloadTrashThumbnail: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "read trash");
      yield* requireScope(principal, "read");
      const metadata = yield* MetadataStore;
      const item = yield* videoOrNotFound(
        yield* trashedReadyOrNotFound(yield* metadata.get(principal.tenantId, id)),
        "Item not found in trash",
      );
      return yield* downloadThumbnail(item.tenantId, item.id);
    }),

  restore: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "restore items");
      yield* requireScope(principal, "write");
      const metadata = yield* MetadataStore;
      const restored = yield* metadata.restore(principal.tenantId, id, now());
      if (!restored) return yield* new NotFound({ message: "Item not found in trash" });
      return restored;
    }),

  purge: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "permanently delete items");
      yield* requireScope(principal, "delete");
      const metadata = yield* MetadataStore;
      const blobs = yield* BlobStore;
      const existing = yield* metadata.get(principal.tenantId, id);
      if (!existing?.deletedAt) return;
      const current =
        existing.status === "ready"
          ? yield* metadata.beginPurge(principal.tenantId, id, now())
          : existing.status === "deleting"
            ? existing
            : null;
      if (!current) return;
      yield* blobs.delete(current.storageKey);
      yield* blobs.delete(current.stagingKey);
      yield* blobs.delete(thumbnailKey(principal.tenantId, id));
      const attempts = yield* metadata.listUploadAttemptsForItem(principal.tenantId, id);
      yield* Effect.forEach(attempts, (attempt) =>
        blobs
          .delete(attempt.stagingKey)
          .pipe(Effect.zipRight(metadata.removeUploadAttempt(attempt.id))),
      );
      yield* metadata.remove(principal.tenantId, id, "deleting");
    }),

  deleteOwnShareUpload: (id: string) =>
    Effect.gen(function* () {
      const share = shareOf(principal);
      if (!share?.allowOwnDelete || !principal.scopes.includes("write")) {
        return yield* new Forbidden({ message: "This share cannot delete uploads" });
      }
      if (!share.identityId) {
        return yield* new Forbidden({ message: "A visitor identity is required" });
      }
      const metadata = yield* MetadataStore;
      const current = yield* metadata.get(principal.tenantId, id);
      if (!current || !canDeleteOwnShareUpload(principal, current)) {
        return yield* new NotFound({ message: "Item not found" });
      }
      const deletedAt = now();
      const deleted = yield* metadata.trash(principal.tenantId, id, deletedAt, (updated) =>
        eventFor(principal, updated, "deleted", {}),
      );
      if (!deleted) return yield* new NotFound({ message: "Item not found" });
    }),

  delete: (id: string) =>
    Effect.gen(function* () {
      yield* forbidShare(principal, "delete items");
      yield* requireScope(principal, "delete");
      const metadata = yield* MetadataStore;
      const current = yield* metadata.get(principal.tenantId, id);
      if (!current) return;
      if (current.status === "ready") {
        if (current.deletedAt) return;
        const deletedAt = now();
        yield* metadata.trash(principal.tenantId, id, deletedAt, (updated) =>
          eventFor(principal, updated, "deleted", {}),
        );
        return;
      }
      const blobs = yield* BlobStore;
      if (current.status !== "deleting") {
        const claimed = yield* metadata.transitionWithEvent(
          principal.tenantId,
          id,
          ["pending", "confirming"],
          { status: "deleting", updatedAt: now() },
          (updated) => eventFor(principal, updated, "deleted", {}),
        );
        if (!claimed) return;
      }
      yield* blobs.delete(current.storageKey);
      const attempts = yield* metadata.listUploadAttemptsForItem(principal.tenantId, id);
      yield* Effect.forEach(attempts, (attempt) =>
        blobs
          .delete(attempt.stagingKey)
          .pipe(Effect.zipRight(metadata.updateUploadAttempt(attempt.id, { state: "abandoned" }))),
      );
      yield* metadata.remove(principal.tenantId, id, "deleting");
    }),
});
