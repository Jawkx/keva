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
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

const encodeKey = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

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

export const makeS3BlobStore = (config: S3BlobStoreConfig): BlobStoreService => {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const request = (
    key: string,
    init: RequestInit,
    accepts: (response: Response) => boolean = (response) => response.ok,
  ): Effect.Effect<Response, StorageUnavailable> =>
    Effect.tryPromise({
      try: async (signal) => {
        const signed = await client.sign(objectUrl(config, key), init);
        return fetch(signed, { signal });
      },
      catch: storageError,
    }).pipe(
      Effect.timeoutOrElse({
        duration: requestTimeoutMs,
        orElse: () => Effect.fail(storageError()),
      }),
      Effect.flatMap((response) =>
        accepts(response) ? Effect.succeed(response) : Effect.fail(storageError()),
      ),
    );

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
        "content-type": contentType,
      }),
    presignDownload: (key) => presign(key, "GET", config.downloadTtlSeconds ?? 300),
    head: (key) =>
      request(
        key,
        { method: "HEAD", headers: { "accept-encoding": "identity" } },
        (response) => response.ok || response.status === 404,
      ).pipe(
        Effect.flatMap((response) => {
          if (response.status === 404) return Effect.succeed(null);
          const contentLength = response.headers.get("content-length");
          if (contentLength === null || !/^\d+$/.test(contentLength)) {
            return Effect.fail(storageError());
          }
          const size = Number(contentLength);
          if (!Number.isSafeInteger(size)) return Effect.fail(storageError());
          return Effect.succeed({
            size,
            etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? null,
            contentType: response.headers.get("content-type"),
          });
        }),
      ),
    copy: (sourceKey, destinationKey, sourceEtag) => {
      const copySource = `/${trimSlashes(config.bucket)}/${encodeKey(sourceKey)}`;
      const headers = sourceEtag
        ? {
            "x-amz-copy-source": copySource,
            "x-amz-copy-source-if-match": `"${sourceEtag}"`,
          }
        : { "x-amz-copy-source": copySource };
      return request(destinationKey, {
        method: "PUT",
        headers,
      }).pipe(
        Effect.flatMap((response) =>
          Effect.tryPromise({ try: () => response.text(), catch: storageError }),
        ),
        Effect.flatMap((body) =>
          /<CopyObjectResult(?:\s|>)/.test(body) && !/<Error(?:\s|>)/.test(body)
            ? Effect.void
            : Effect.fail(storageError()),
        ),
      );
    },
    delete: (key) =>
      request(key, { method: "DELETE" }, (response) => response.ok || response.status === 404).pipe(
        Effect.asVoid,
      ),
  };
};

export const S3BlobStoreLive = (config: S3BlobStoreConfig): Layer.Layer<BlobStore> =>
  Layer.sync(BlobStore, () => makeS3BlobStore(config));
