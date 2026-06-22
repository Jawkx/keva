import { StorageUnavailable } from "@keva/schema";
import { AwsClient } from "aws4fetch";
import { Effect, Layer } from "effect";
import { BlobStore, type BlobStoreService } from "./services.js";

export interface S3BlobStoreConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle?: boolean;
  readonly uploadTtlSeconds?: number;
  readonly downloadTtlSeconds?: number;
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

const objectUrl = (config: S3BlobStoreConfig, key: string): string => {
  const endpoint = new URL(config.endpoint);
  const path = encodeKey(key);
  if (config.forcePathStyle ?? true) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(config.bucket)}/${path}`;
  } else {
    endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${path}`;
  }
  return endpoint.toString();
};

const storageError = (): StorageUnavailable =>
  new StorageUnavailable({ message: "Blob storage unavailable" });

const requestEffect = (
  operation: () => Promise<Response>,
): Effect.Effect<Response, StorageUnavailable> =>
  Effect.tryPromise({ try: operation, catch: storageError }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(storageError())
    ),
  );

export const makeS3BlobStore = (
  config: S3BlobStoreConfig,
): BlobStoreService => {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });

  const presign = (
    key: string,
    method: "PUT" | "GET",
    ttlSeconds: number,
    headers: Record<string, string> = {},
  ) =>
    Effect.tryPromise({
      try: async () => {
        const url = new URL(objectUrl(config, key));
        url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
        const signed = await client.sign(url.toString(), {
          method,
          headers,
          aws: { signQuery: true, allHeaders: true },
        });
        return {
          url: signed.url,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
          headers,
        };
      },
      catch: storageError,
    });

  return {
    presignUpload: (key, size, contentType) =>
      presign(key, "PUT", config.uploadTtlSeconds ?? 900, {
        "content-length": String(size),
        "content-type": contentType,
      }),
    presignDownload: (key) =>
      presign(key, "GET", config.downloadTtlSeconds ?? 300),
    head: (key) =>
      Effect.tryPromise({
        try: async () => {
          const signed = await client.sign(objectUrl(config, key), {
            method: "HEAD",
          });
          const response = await fetch(signed);
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`HEAD failed: ${response.status}`);
          const size = Number(response.headers.get("content-length"));
          if (!Number.isFinite(size)) throw new Error("Missing content length");
          return {
            size,
            etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? null,
            contentType: response.headers.get("content-type"),
          };
        },
        catch: storageError,
      }),
    copy: (sourceKey, destinationKey) =>
      requestEffect(async () => {
        const copySource = `/${trimSlashes(config.bucket)}/${encodeKey(sourceKey)}`;
        const request = await client.sign(objectUrl(config, destinationKey), {
          method: "PUT",
          headers: { "x-amz-copy-source": copySource },
        });
        return fetch(request);
      }).pipe(Effect.asVoid),
    delete: (key) =>
      Effect.tryPromise({
        try: async () => {
          const request = await client.sign(objectUrl(config, key), {
            method: "DELETE",
          });
          const response = await fetch(request);
          if (!response.ok && response.status !== 404) {
            throw new Error(`DELETE failed: ${response.status}`);
          }
        },
        catch: storageError,
      }),
  };
};

export const S3BlobStoreLive = (
  config: S3BlobStoreConfig,
): Layer.Layer<BlobStore> =>
  Layer.sync(BlobStore, () => makeS3BlobStore(config));
