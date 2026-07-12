import {
  PostgresMetadataStoreLive,
  S3BlobStoreLive,
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
}

export interface LifecycleResult {
  readonly reaped: number;
  readonly deleted: number;
  readonly staging: number;
}

export const runLifecycle = (config: LifecycleConfig): Promise<LifecycleResult> => {
  const layer = Layer.merge(
    PostgresMetadataStoreLive({ url: config.databaseUrl }),
    S3BlobStoreLive(config.s3),
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const reaped = yield* reapPending(config);
      const deleted = yield* sweepDeleting(config);
      const staging = yield* sweepStaging(config);
      return { reaped, deleted, staging };
    }).pipe(Effect.provide(layer)),
  );
};
