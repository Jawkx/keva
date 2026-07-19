import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeS3BlobStore } from "./s3.js";

const store = makeS3BlobStore({
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "keva",
  forcePathStyle: true,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3BlobStore", () => {
  it("presigns a path-style staging PUT with browser-settable upload headers", async () => {
    const signed = await Effect.runPromise(
      store.presignUpload("staging/tenant/object", 42, "text/plain"),
    );
    const url = new URL(signed.url);

    expect(url.pathname).toBe("/keva/staging/tenant/object");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).not.toContain("content-length");
    expect(signed.headers).toEqual({
      "content-type": "text/plain",
    });
  });

  it("reads metadata from a successful HEAD response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "42",
          "content-type": "text/plain",
          etag: '"object-etag"',
        },
      }),
    );

    await expect(Effect.runPromise(store.head("objects/item"))).resolves.toEqual({
      size: 42,
      etag: "object-etag",
      contentType: "text/plain",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("conditionally copies and validates the CopyObject result", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("<CopyObjectResult><ETag>etag</ETag></CopyObjectResult>", { status: 200 }),
      );

    await expect(
      Effect.runPromise(store.copy("staging/source", "items/final", "etag")),
    ).resolves.toBeUndefined();
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get("x-amz-copy-source-if-match")).toBe('"etag"');
  });

  it("rejects an embedded CopyObject error returned with HTTP 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<Error><Code>InternalError</Code></Error>", { status: 200 }),
    );

    await expect(
      Effect.runPromise(Effect.flip(store.copy("staging/source", "items/final", "etag"))),
    ).resolves.toMatchObject({ _tag: "StorageUnavailable" });
  });

  it.each([undefined, "", "invalid", "-1", "1.5"])(
    "rejects a successful HEAD with invalid content-length %s",
    async (contentLength) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 200,
          ...(contentLength === undefined ? {} : { headers: { "content-length": contentLength } }),
        }),
      );

      await expect(
        Effect.runPromise(Effect.flip(store.head("objects/item"))),
      ).resolves.toMatchObject({
        _tag: "StorageUnavailable",
        message: "Blob storage unavailable",
      });
    },
  );

  it("aborts and safely fails a request that exceeds its timeout", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        }),
    );
    const timeoutStore = makeS3BlobStore({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      bucket: "keva",
      requestTimeoutMs: 50,
    });

    await expect(
      Effect.runPromise(Effect.flip(timeoutStore.head("objects/item"))),
    ).resolves.toMatchObject({
      _tag: "StorageUnavailable",
      message: "Blob storage unavailable",
    });
    expect(signal?.aborted).toBe(true);
  });
});
