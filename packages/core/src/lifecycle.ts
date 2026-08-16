import type { KevaError, KevaItem } from "@keva/schema";
import { Effect } from "effect";
import { BlobStore, MetadataStore } from "./services.js";

const now = (): string => new Date().toISOString();

export interface LifecycleJobOptions {
  readonly batchSize?: number;
  readonly pendingTtlMs?: number;
  readonly concurrency?: number;
  readonly maxBatches?: number;
}

export interface LifecycleBatchResult {
  readonly completed: number;
  readonly failed: number;
}

type LifecyclePhase = "reap_pending" | "sweep_deleting" | "sweep_staging";

const lifecycleConcurrency = (options: LifecycleJobOptions): number => {
  const concurrency = options.concurrency ?? 8;
  return Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
};

const runLifecycleBatch = <R>(
  phase: LifecyclePhase,
  items: ReadonlyArray<KevaItem>,
  concurrency: number,
  operation: (item: KevaItem) => Effect.Effect<boolean, KevaError, R>,
): Effect.Effect<LifecycleBatchResult, never, R> =>
  Effect.forEach(
    items,
    (item) =>
      operation(item).pipe(
        Effect.map((completed) => ({ completed, failed: false })),
        Effect.catch((error) =>
          Effect.logWarning(
            JSON.stringify({
              event: "lifecycle.item.failed",
              phase,
              tenantId: item.tenantId,
              itemId: item.id,
              errorTag: error._tag,
            }),
          ).pipe(Effect.as({ completed: false, failed: true })),
        ),
      ),
    { concurrency },
  ).pipe(
    Effect.map((results) => ({
      completed: results.filter((result) => result.completed).length,
      failed: results.filter((result) => result.failed).length,
    })),
  );

export const reapPending = (options: LifecycleJobOptions = {}) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const cutoff = new Date(Date.now() - (options.pendingTtlMs ?? 60 * 60 * 1000)).toISOString();
    const pending = [
      ...(yield* metadata.listByStatus("pending", options.batchSize ?? 100, cutoff)),
      ...(yield* metadata.listByStatus("confirming", options.batchSize ?? 100, cutoff)),
    ].slice(0, options.batchSize ?? 100);
    return yield* runLifecycleBatch(
      "reap_pending",
      pending,
      lifecycleConcurrency(options),
      (item) =>
        metadata.transition(
          item.tenantId,
          item.id,
          [item.status],
          { status: "deleting", updatedAt: now() },
          cutoff,
        ),
    );
  });

export const sweepDeleting = (options: LifecycleJobOptions = {}) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const blobs = yield* BlobStore;
    const deleting = yield* metadata.listByStatus("deleting", options.batchSize ?? 100);
    return yield* runLifecycleBatch(
      "sweep_deleting",
      deleting,
      lifecycleConcurrency(options),
      (item) =>
        Effect.gen(function* () {
          yield* blobs.delete(item.storageKey);
          yield* blobs.delete(item.stagingKey);
          const attempts = yield* metadata.listUploadAttemptsForItem(item.tenantId, item.id);
          yield* Effect.forEach(attempts, (attempt) =>
            blobs
              .delete(attempt.stagingKey)
              .pipe(
                Effect.andThen(metadata.updateUploadAttempt(attempt.id, { state: "abandoned" })),
              ),
          );
          return yield* metadata.remove(item.tenantId, item.id, "deleting");
        }),
    );
  });

export const sweepStaging = (options: LifecycleJobOptions = {}) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataStore;
    const blobs = yield* BlobStore;
    const attempts = yield* metadata.listUploadAttemptsForCleanup(options.batchSize ?? 100, now());
    const results = yield* Effect.forEach(
      attempts,
      (attempt) =>
        blobs.delete(attempt.stagingKey).pipe(
          Effect.andThen(
            attempt.state === "abandoned" || attempt.state === "confirming"
              ? blobs.delete(attempt.storageKey)
              : Effect.void,
          ),
          Effect.andThen(metadata.removeUploadAttempt(attempt.id)),
          Effect.map((completed) => ({ completed, failed: false })),
          Effect.catch(() =>
            metadata
              .updateUploadAttempt(attempt.id, {
                retryCount: attempt.retryCount + 1,
                nextRetryAt: new Date(
                  Date.now() + Math.min(60 * 60_000, 2 ** attempt.retryCount * 60_000),
                ).toISOString(),
              })
              .pipe(Effect.as({ completed: false, failed: true })),
          ),
        ),
      { concurrency: lifecycleConcurrency(options) },
    );
    return {
      completed: results.filter((result) => result.completed).length,
      failed: results.filter((result) => result.failed).length,
    };
  });
