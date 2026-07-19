import {
  PostgresMetadataStoreLive,
  S3BlobStoreLive,
  BlobStore,
  MetadataStore,
  reapPending,
  sweepDeleting,
  sweepStaging,
  type S3BlobStoreConfig,
} from "@keva/core";
import { Effect, Layer } from "effect";

export interface LifecycleConfig {
  readonly databaseUrl: string;
  readonly s3: S3BlobStoreConfig;
  readonly batchSize?: number;
  readonly pendingTtlMs?: number;
  readonly concurrency?: number;
  readonly maxBatches?: number;
}

export interface LifecycleResult {
  readonly reaped: number;
  readonly reapFailed: number;
  readonly deleted: number;
  readonly deleteFailed: number;
  readonly staging: number;
  readonly stagingFailed: number;
}

export const runLifecycle = (config: LifecycleConfig): Promise<LifecycleResult> => {
  const layer = Layer.merge(
    PostgresMetadataStoreLive({ url: config.databaseUrl }),
    S3BlobStoreLive(config.s3),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const drain = <A extends { readonly completed: number; readonly failed: number }, E>(
        job: () => Effect.Effect<A, E, MetadataStore | BlobStore>,
      ) =>
        Effect.gen(function* () {
          let completed = 0;
          let failed = 0;
          for (let batch = 0; batch < (config.maxBatches ?? 10); batch++) {
            const result = yield* job();
            completed += result.completed;
            failed += result.failed;
            if (
              result.completed + result.failed < (config.batchSize ?? 100) ||
              result.completed === 0
            )
              break;
          }
          return { completed, failed };
        });
      const reaped = yield* drain(() => reapPending(config));
      const deleted = yield* drain(() => sweepDeleting(config));
      const staging = yield* drain(() => sweepStaging(config));
      return {
        reaped: reaped.completed,
        reapFailed: reaped.failed,
        deleted: deleted.completed,
        deleteFailed: deleted.failed,
        staging: staging.completed,
        stagingFailed: staging.failed,
      };
    }).pipe(Effect.provide(layer)),
  );
};
