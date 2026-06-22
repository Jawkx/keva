import {
  BlobStore,
  MetadataStore,
  MemoryMetadataStoreLive,
  S3BlobStoreLive,
  makeKevaEngine,
  reapPending,
  sweepDeleting,
} from "@keva/core";
import type { Principal } from "@keva/schema";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type S3Mock, startS3Mock } from "./test/s3-mock.js";

/**
 * Real (SigV4-signed) S3 byte flow against an in-memory S3-compatible mock:
 *  - a file uploads to STAGING, confirm copies it to the IMMUTABLE FINAL key;
 *  - the server never streams bytes (presigned upload/download + server-side
 *    copy);
 *  - an abandoned `pending` is reaped to `deleting` and swept to completion;
 *  - replaying a still-valid staging PUT cannot alter a `ready` object.
 *
 * Lives in @keva/server (not @keva/core) because the mock needs Node's http
 * server types, which only this package depends on.
 */

const principal: Principal = {
  tenantId: "t1",
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
};

const putToPresigned = async (
  url: string,
  bytes: Uint8Array,
  contentType: string,
) => {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
    },
    body: bytes.slice().buffer as ArrayBuffer,
  });
  if (!res.ok) throw new Error(`presigned PUT failed: ${res.status}`);
};

const getFromPresigned = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`presigned GET failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

describe("S3 blob store + lifecycle jobs (real byte flow)", () => {
  let mock: S3Mock;
  let runtime: ManagedRuntime.ManagedRuntime<BlobStore | MetadataStore, never>;

  const makeRuntime = (m: S3Mock) =>
    ManagedRuntime.make(
      Layer.merge(
        MemoryMetadataStoreLive,
        S3BlobStoreLive({
          endpoint: m.endpoint,
          region: "auto",
          accessKeyId: "test",
          secretAccessKey: "test",
          bucket: m.bucket,
          forcePathStyle: true,
        }),
      ),
    );

  beforeEach(async () => {
    mock = await startS3Mock();
    runtime = makeRuntime(mock);
  });
  afterEach(async () => {
    await runtime.dispose();
    await mock.close();
  });

  it("uploads to staging, confirm copies to the immutable final key", async () => {
    const bytes = new TextEncoder().encode("immutable bytes");
    const engine = makeKevaEngine(principal);

    const initiated = await runtime.runPromise(
      engine.initiate({
        name: "f.bin",
        contentType: "application/octet-stream",
        size: bytes.byteLength,
        source: "upload",
        attributes: {},
      }),
    );
    const { id } = initiated.object;

    expect(initiated.uploadUrl).toContain(`staging/t1/${id}`);
    await putToPresigned(
      initiated.uploadUrl,
      bytes,
      "application/octet-stream",
    );
    expect(mock.store.has(`staging/t1/${id}`)).toBe(true);

    const confirmed = await runtime.runPromise(engine.confirm(id));
    expect(confirmed.status).toBe("ready");
    expect(confirmed.storageKey).toBe(`objects/t1/${id}`);

    // final key has the bytes; staging was cleaned up after the copy
    expect(mock.store.has(`objects/t1/${id}`)).toBe(true);
    expect(mock.store.has(`staging/t1/${id}`)).toBe(false);

    const dl = await runtime.runPromise(engine.download(id));
    expect(dl.url).toContain(`objects/t1/${id}`);
    expect(new TextDecoder().decode(await getFromPresigned(dl.url))).toBe(
      "immutable bytes",
    );
  });

  it("replaying a staging URL cannot alter a ready object", async () => {
    const original = new TextEncoder().encode("ORIGINAL");
    const tampered = new TextEncoder().encode("TAMPERED!");
    const engine = makeKevaEngine(principal);

    const initiated = await runtime.runPromise(
      engine.initiate({
        name: "x",
        contentType: "text/plain",
        size: original.byteLength,
        source: "upload",
        attributes: {},
      }),
    );
    const { id } = initiated.object;

    await putToPresigned(initiated.uploadUrl, original, "text/plain");
    await runtime.runPromise(engine.confirm(id));

    // Replay the (still-unexpired) staging PUT with different bytes. This only
    // rewrites the staging key — the immutable final key was already copied.
    await putToPresigned(initiated.uploadUrl, tampered, "text/plain");

    const dl = await runtime.runPromise(engine.download(id));
    expect(new TextDecoder().decode(await getFromPresigned(dl.url))).toBe(
      "ORIGINAL",
    );
  });

  it("reaps an abandoned pending upload and sweeps it to completion", async () => {
    const bytes = new TextEncoder().encode("abandoned");
    const id = crypto.randomUUID();
    const timestamp = new Date(Date.now() - 10_000).toISOString();
    await runtime.runPromise(
      Effect.flatMap(MetadataStore, (metadata) =>
        metadata.insert({
          id,
          tenantId: "t1",
          name: "a",
          contentType: "text/plain",
          declaredSize: bytes.byteLength,
          size: null,
          etag: null,
          checksum: null,
          source: "upload",
          status: "pending",
          storageKey: `objects/t1/${id}`,
          stagingKey: `staging/t1/${id}`,
          createdAt: timestamp,
          updatedAt: timestamp,
          attributes: {},
        }),
      ),
    );
    await putToPresigned(
      `${mock.endpoint}/${mock.bucket}/staging/t1/${id}`,
      bytes,
      "text/plain",
    );
    expect(mock.store.has(`staging/t1/${id}`)).toBe(true);

    const reaped = await runtime.runPromise(reapPending({ pendingTtlMs: 1 }));
    expect(reaped).toBe(1);

    const swept = await runtime.runPromise(sweepDeleting());
    expect(swept).toBe(1);

    const found = await runtime.runPromise(
      Effect.flatMap(MetadataStore, (m) => m.get("t1", id)),
    );
    expect(found).toBeNull();
    expect(mock.store.has(`staging/t1/${id}`)).toBe(false);
  });

  it("sweeps a delete to completion (no orphan blobs)", async () => {
    const bytes = new TextEncoder().encode("to-delete");
    const engine = makeKevaEngine(principal);

    const initiated = await runtime.runPromise(
      engine.initiate({
        name: "d",
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        attributes: {},
      }),
    );
    const { id } = initiated.object;
    await putToPresigned(initiated.uploadUrl, bytes, "text/plain");
    await runtime.runPromise(engine.confirm(id));
    expect(mock.store.has(`objects/t1/${id}`)).toBe(true);

    // record delete intent (ready → deleting), then let the sweeper finish it
    await runtime.runPromise(
      Effect.flatMap(MetadataStore, (m) =>
        m.transition("t1", id, ["ready"], {
          status: "deleting",
          updatedAt: new Date().toISOString(),
        }),
      ),
    );
    const swept = await runtime.runPromise(sweepDeleting());
    expect(swept).toBe(1);

    expect(mock.store.has(`objects/t1/${id}`)).toBe(false);
    const found = await runtime.runPromise(
      Effect.flatMap(MetadataStore, (m) => m.get("t1", id)),
    );
    expect(found).toBeNull();
  });
});
