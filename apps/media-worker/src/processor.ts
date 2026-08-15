import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { makeThumbnailJobStore, type ClaimedThumbnailJob } from "@keva/core/postgres";
import { AwsClient } from "aws4fetch";
import { fileTypeFromFile } from "file-type";
import postgres, { type Sql } from "postgres";
import sharp from "sharp";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const OUTPUT_SIZE = 640;
const OUTPUT_QUALITY = 80;
const PROCESSING_TIMEOUT_MS = 30_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
}

interface DrainSummary {
  readonly attempted: number;
  readonly readyItemIds: readonly string[];
  readonly failedItemIds: readonly string[];
  readonly retriedItemIds: readonly string[];
}

class PermanentProcessingError extends Error {}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const storageConfig = (): StorageConfig => ({
  endpoint: required("S3_ENDPOINT"),
  region: process.env.S3_REGION || "auto",
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  bucket: required("S3_BUCKET"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
});

const objectUrl = (config: StorageConfig, key: string): URL => {
  const endpoint = new URL(config.endpoint);
  const path = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return config.forcePathStyle
    ? new URL(`/${encodeURIComponent(config.bucket)}/${path}`, endpoint)
    : new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}/${path}`);
};

const awsClient = (config: StorageConfig): AwsClient =>
  new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });

const boundedDownload = async (
  client: AwsClient,
  config: StorageConfig,
  key: string,
  destination: string,
): Promise<void> => {
  const response = await client.fetch(objectUrl(config, key));
  if (!response.ok || !response.body) throw new Error(`SourceDownload${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || "0");
  if (declaredSize > MAX_SOURCE_BYTES) throw new PermanentProcessingError("SourceTooLarge");
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(
        received > MAX_SOURCE_BYTES ? new PermanentProcessingError("SourceTooLarge") : null,
        chunk,
      );
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(destination));
};

export const renderImageThumbnail = async (
  inputPath: string,
  outputPath: string,
): Promise<{ readonly width: number; readonly height: number; readonly size: number }> => {
  const detected = await fileTypeFromFile(inputPath);
  if (!detected || !ALLOWED_TYPES.has(detected.mime)) {
    throw new PermanentProcessingError("UnsupportedSourceType");
  }
  const render = sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: OUTPUT_QUALITY })
    .toFile(outputPath);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ProcessingTimeout")), PROCESSING_TIMEOUT_MS);
    });
    const info = await Promise.race([render, timeout]);
    if (info.size > MAX_OUTPUT_BYTES) throw new PermanentProcessingError("OutputTooLarge");
    return { width: info.width, height: info.height, size: info.size };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const verifyClaim = async (sql: Sql, job: ClaimedThumbnailJob): Promise<boolean> => {
  const rows = await sql<{ valid: boolean }[]>`
    select exists(
      select 1 from items as item
      join thumbnail_jobs as thumbnail on thumbnail.tenant_id = item.tenant_id
        and thumbnail.item_id = item.id
      where item.tenant_id = ${job.tenantId} and item.id = ${job.itemId}
        and item.status = 'ready' and item.deleted_at is null
        and item.etag is not distinct from ${job.sourceEtag}
        and thumbnail.state = 'processing' and thumbnail.lease_token = ${job.leaseToken}
    ) as valid
  `;
  return rows[0]?.valid ?? false;
};

const uploadOutput = async (
  client: AwsClient,
  config: StorageConfig,
  key: string,
  body: Uint8Array,
): Promise<void> => {
  const response = await client.fetch(objectUrl(config, key), {
    method: "PUT",
    headers: {
      "content-length": String(body.byteLength),
      "content-type": "image/webp",
    },
    body: body as unknown as BodyInit,
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`OutputUpload${response.status}`);
};

const deleteOutput = async (
  client: AwsClient,
  config: StorageConfig,
  key: string,
): Promise<void> => {
  const response = await client.fetch(objectUrl(config, key), { method: "DELETE" });
  await response.body?.cancel();
};

const processJob = async (
  sql: Sql,
  job: ClaimedThumbnailJob,
  client: AwsClient,
  config: StorageConfig,
): Promise<"ready" | "retry" | "failed"> => {
  const jobs = makeThumbnailJobStore(sql);
  const directory = await mkdtemp(join(tmpdir(), "keva-thumbnail-"));
  const inputPath = join(directory, "source");
  const outputPath = join(directory, "thumbnail.webp");
  const outputKey = `thumbnails/${job.tenantId}/${job.itemId}/v${job.recipeVersion}.webp`;
  let uploaded = false;
  try {
    if (!(await verifyClaim(sql, job))) throw new PermanentProcessingError("SourceChanged");
    await boundedDownload(client, config, job.storageKey, inputPath);
    const info = await renderImageThumbnail(inputPath, outputPath);
    const output = await readFile(outputPath);
    if (!(await verifyClaim(sql, job))) throw new PermanentProcessingError("SourceChanged");
    await uploadOutput(client, config, outputKey, output);
    uploaded = true;
    const finalized = await jobs.markReady(job.tenantId, job.itemId, job.leaseToken, {
      key: outputKey,
      contentType: "image/webp",
      size: info.size,
      width: info.width,
      height: info.height,
    });
    if (!finalized) {
      await deleteOutput(client, config, outputKey);
      return "failed";
    }
    return "ready";
  } catch (error) {
    if (uploaded) await deleteOutput(client, config, outputKey).catch(() => undefined);
    const errorCode =
      error instanceof Error ? error.message.slice(0, 128) : "UnknownProcessingError";
    if (error instanceof PermanentProcessingError) {
      await jobs.markFailed(job.tenantId, job.itemId, job.leaseToken, errorCode);
      return "failed";
    }
    const result = await jobs.markRetry(job.tenantId, job.itemId, job.leaseToken, errorCode);
    return result?.state === "failed" ? "failed" : "retry";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

export const drainThumbnailJobs = async (): Promise<DrainSummary> => {
  const sql = postgres(required("DATABASE_URL"), { max: 1, connect_timeout: 10, idle_timeout: 5 });
  const jobs = makeThumbnailJobStore(sql);
  const config = storageConfig();
  const client = awsClient(config);
  const batchSize = Math.max(1, Math.min(20, Number(process.env.THUMBNAIL_BATCH_SIZE || "5")));
  const deadline = Date.now() + 8 * 60_000;
  const readyItemIds: string[] = [];
  const failedItemIds: string[] = [];
  const retriedItemIds: string[] = [];
  let attempted = 0;
  try {
    while (attempted < batchSize && Date.now() < deadline) {
      const job = await jobs.claimNext({ leaseMs: PROCESSING_TIMEOUT_MS + 30_000 });
      if (!job) break;
      attempted += 1;
      const result = await processJob(sql, job, client, config);
      if (result === "ready") readyItemIds.push(job.itemId);
      else if (result === "failed") failedItemIds.push(job.itemId);
      else retriedItemIds.push(job.itemId);
    }
    return { attempted, readyItemIds, failedItemIds, retriedItemIds };
  } finally {
    await sql.end({ timeout: 5 });
  }
};
