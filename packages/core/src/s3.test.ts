import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeS3BlobStore } from "./s3.js";

const store = makeS3BlobStore({
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "keva",
  forcePathStyle: true,
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
});
