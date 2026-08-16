import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { makeThumbnailJobStore, type ClaimedThumbnailJob } from "@keva/core/postgres";
import { AwsClient } from "aws4fetch";
import { Data, Effect } from "effect";
import { fileTypeFromFile } from "file-type";
import postgres, { type Sql } from "postgres";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const OUTPUT_SIZE = 640;
const PROCESSING_TIMEOUT_MS = 30_000;
const STORAGE_TIMEOUT_MS = 30_000;
const LEASE_DURATION_MS = PROCESSING_TIMEOUT_MS + STORAGE_TIMEOUT_MS * 2 + 30_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
}
interface ProcessedItem {
  readonly tenantId: string;
  readonly itemId: string;
}
export interface DrainSummary {
  readonly attempted: number;
  readonly readyItems: readonly ProcessedItem[];
  readonly failedItems: readonly ProcessedItem[];
  readonly retriedItems: readonly ProcessedItem[];
}
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
}> {}
export class ProcessingError extends Data.TaggedError("ProcessingError")<{
  readonly message: string;
  readonly permanent: boolean;
  readonly cause?: unknown;
}> {}

const required = (name: string) => {
  const value = process.env[name];
  return value
    ? Effect.succeed(value)
    : Effect.fail(new ConfigurationError({ message: `${name} is required` }));
};

const storageConfig = Effect.gen(function* () {
  return {
    endpoint: yield* required("S3_ENDPOINT"),
    region: process.env.S3_REGION || "auto",
    accessKeyId: yield* required("S3_ACCESS_KEY_ID"),
    secretAccessKey: yield* required("S3_SECRET_ACCESS_KEY"),
    bucket: yield* required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  } satisfies StorageConfig;
});

const objectUrl = (config: StorageConfig, key: string) => {
  const endpoint = new URL(config.endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  return config.forcePathStyle
    ? new URL(`/${encodeURIComponent(config.bucket)}/${path}`, endpoint)
    : new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}/${path}`);
};
const awsClient = (config: StorageConfig) =>
  new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
const processingError = (message: string, permanent = false, cause?: unknown) =>
  new ProcessingError({ message, permanent, cause });
const tryProcessing = <A>(try_: (signal: AbortSignal) => Promise<A>, message: string) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) =>
      processingError(cause instanceof Error ? cause.message : message, false, cause),
  });

const boundedDownload = (
  client: AwsClient,
  config: StorageConfig,
  key: string,
  destination: string,
) =>
  Effect.gen(function* () {
    const response = yield* tryProcessing(
      (signal) => client.fetch(objectUrl(config, key), { signal }),
      "SourceDownload",
    ).pipe(
      Effect.timeoutOrElse({
        duration: STORAGE_TIMEOUT_MS,
        orElse: () => Effect.fail(processingError("StorageTimeout")),
      }),
    );
    if (!response.ok || !response.body)
      return yield* processingError(`SourceDownload${response.status}`);
    if (Number(response.headers.get("content-length") || "0") > MAX_SOURCE_BYTES)
      return yield* processingError("SourceTooLarge", true);
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(
          received > MAX_SOURCE_BYTES ? processingError("SourceTooLarge", true) : null,
          chunk,
        );
      },
    });
    yield* tryProcessing(
      () =>
        pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(destination)),
      "SourceDownload",
    );
  });

export const renderImageThumbnail = (inputPath: string, outputPath: string) =>
  Effect.gen(function* () {
    const detected = yield* tryProcessing(
      () => fileTypeFromFile(inputPath),
      "SourceDetectionFailed",
    );
    if (!detected || !ALLOWED_TYPES.has(detected.mime))
      return yield* processingError("UnsupportedSourceType", true);
    const image = sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 });
    const info = yield* tryProcessing(() => image.toFile(outputPath), "ProcessingFailed").pipe(
      Effect.timeoutOrElse({
        duration: PROCESSING_TIMEOUT_MS,
        orElse: () => Effect.fail(processingError("ProcessingTimeout")),
      }),
      Effect.ensuring(Effect.sync(() => image.destroy())),
    );
    if (info.size > MAX_OUTPUT_BYTES) return yield* processingError("OutputTooLarge", true);
    return { width: info.width, height: info.height, size: info.size };
  });

const verifyClaim = (sql: Sql, job: ClaimedThumbnailJob) =>
  tryProcessing(async () => {
    const rows = await sql<
      { valid: boolean }[]
    >`select exists(select 1 from items as item join thumbnail_jobs as thumbnail on thumbnail.tenant_id = item.tenant_id and thumbnail.item_id = item.id where item.tenant_id = ${job.tenantId} and item.id = ${job.itemId} and item.status = 'ready' and item.deleted_at is null and item.etag is not distinct from ${job.sourceEtag} and thumbnail.state = 'processing' and thumbnail.lease_token = ${job.leaseToken}) as valid`;
    return rows[0]?.valid ?? false;
  }, "ClaimVerificationFailed");

const uploadOutput = (client: AwsClient, config: StorageConfig, key: string, body: Uint8Array) =>
  Effect.gen(function* () {
    const response = yield* tryProcessing(
      (signal) =>
        client.fetch(objectUrl(config, key), {
          method: "PUT",
          signal,
          headers: { "content-length": String(body.byteLength), "content-type": "image/webp" },
          body: body as unknown as BodyInit,
        }),
      "OutputUpload",
    ).pipe(
      Effect.timeoutOrElse({
        duration: STORAGE_TIMEOUT_MS,
        orElse: () => Effect.fail(processingError("StorageTimeout")),
      }),
    );
    yield* tryProcessing(() => response.body?.cancel() ?? Promise.resolve(), "ResponseCleanup");
    if (!response.ok) return yield* processingError(`OutputUpload${response.status}`);
  });

const processJob = (
  sql: Sql,
  job: ClaimedThumbnailJob,
  client: AwsClient,
  config: StorageConfig,
) => {
  const jobs = makeThumbnailJobStore(sql);
  const run = Effect.acquireUseRelease(
    tryProcessing(() => mkdtemp(join(tmpdir(), "keva-thumbnail-")), "TempDirectoryCreate"),
    (directory) =>
      Effect.gen(function* () {
        const inputPath = join(directory, "source");
        const outputPath = join(directory, "thumbnail.webp");
        const outputKey = `thumbnails/${job.tenantId}/${job.itemId}/v${job.recipeVersion}.webp`;
        if (!(yield* verifyClaim(sql, job))) return yield* processingError("SourceChanged", true);
        yield* boundedDownload(client, config, job.storageKey, inputPath);
        const info = yield* renderImageThumbnail(inputPath, outputPath);
        const output = yield* tryProcessing(() => readFile(outputPath), "OutputReadFailed");
        if (!(yield* verifyClaim(sql, job))) return yield* processingError("SourceChanged", true);
        yield* uploadOutput(client, config, outputKey, output);
        const finalized = yield* tryProcessing(
          () =>
            jobs.markReady(job.tenantId, job.itemId, job.leaseToken, {
              key: outputKey,
              contentType: "image/webp",
              size: info.size,
              width: info.width,
              height: info.height,
            }),
          "FinalizeFailed",
        );
        return finalized ? ("ready" as const) : ("failed" as const);
      }),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
  return run.pipe(
    Effect.catch((error) => {
      const code = error.message.slice(0, 128);
      return error.permanent
        ? tryProcessing(
            () => jobs.markFailed(job.tenantId, job.itemId, job.leaseToken, code),
            "MarkFailed",
          ).pipe(Effect.as("failed" as const))
        : tryProcessing(
            () => jobs.markRetry(job.tenantId, job.itemId, job.leaseToken, code),
            "MarkRetry",
          ).pipe(
            Effect.map((result) =>
              result?.state === "failed" ? ("failed" as const) : ("retry" as const),
            ),
          );
    }),
  );
};

const database = (url: string) =>
  Effect.acquireRelease(
    Effect.sync(() => postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5 })),
    (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
  );

export const drainThumbnailJobs = Effect.gen(function* () {
  const databaseUrl = yield* required("DATABASE_URL");
  const config = yield* storageConfig;
  const configured = Number(process.env.THUMBNAIL_BATCH_SIZE ?? 5);
  if (!Number.isSafeInteger(configured) || configured < 1)
    return yield* new ConfigurationError({
      message: "THUMBNAIL_BATCH_SIZE must be a positive integer",
    });
  const batchSize = Math.min(20, configured);
  const sql = yield* database(databaseUrl);
  const jobs = makeThumbnailJobStore(sql);
  const client = awsClient(config);
  const readyItems: ProcessedItem[] = [];
  const failedItems: ProcessedItem[] = [];
  const retriedItems: ProcessedItem[] = [];
  let attempted = 0;
  let exhausted = false;
  yield* Effect.whileLoop({
    while: () => attempted < batchSize && !exhausted,
    body: () =>
      tryProcessing(() => jobs.claimNext({ leaseMs: LEASE_DURATION_MS }), "ClaimFailed").pipe(
        Effect.flatMap((job) => {
          if (!job) return Effect.succeed(undefined);
          attempted += 1;
          return processJob(sql, job, client, config).pipe(
            Effect.map((result) => ({ job, result })),
          );
        }),
      ),
    step: (processed) => {
      if (!processed) {
        exhausted = true;
        return;
      }
      const item = { tenantId: processed.job.tenantId, itemId: processed.job.itemId };
      if (processed.result === "ready") readyItems.push(item);
      else if (processed.result === "failed") failedItems.push(item);
      else retriedItems.push(item);
    },
  });
  return { attempted, readyItems, failedItems, retriedItems } satisfies DrainSummary;
}).pipe(Effect.scoped);
