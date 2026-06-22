import {
  PostgresMetadataStoreLive,
  reapPending,
  S3BlobStoreLive,
  sweepDeleting,
} from "@keva/core";
import { Effect, Layer } from "effect";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!process.env.S3_ENDPOINT) throw new Error("S3_ENDPOINT is required");

const metadata = PostgresMetadataStoreLive({ url: databaseUrl });
const blobs = S3BlobStoreLive({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.S3_BUCKET ?? "",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
});
const layer = Layer.merge(metadata, blobs);

const program = Effect.gen(function* () {
  const reaped = yield* reapPending();
  const swept = yield* sweepDeleting();
  return { reaped, swept };
}).pipe(Effect.provide(layer));

console.log(await Effect.runPromise(program));
