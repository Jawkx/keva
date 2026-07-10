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

const principal: Principal = {
  tenantId: "t1",
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
};

const putToPresigned = async (url: string, bytes: Uint8Array, contentType: string) => {
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

const s3Env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

const realS3Config =
  s3Env?.KEVA_TEST_S3_ENDPOINT &&
  s3Env.KEVA_TEST_S3_ACCESS_KEY_ID &&
  s3Env.KEVA_TEST_S3_SECRET_ACCESS_KEY &&
  s3Env.KEVA_TEST_S3_BUCKET
    ? {
        endpoint: s3Env.KEVA_TEST_S3_ENDPOINT,
        region: s3Env.KEVA_TEST_S3_REGION ?? "us-east-1",
        accessKeyId: s3Env.KEVA_TEST_S3_ACCESS_KEY_ID,
        secretAccessKey: s3Env.KEVA_TEST_S3_SECRET_ACCESS_KEY,
        bucket: s3Env.KEVA_TEST_S3_BUCKET,
        forcePathStyle: s3Env.KEVA_TEST_S3_FORCE_PATH_STYLE !== "false",
      }
    : undefined;

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
        properties: {},
      }),
    );
    const { id } = initiated.item;

    expect(initiated.uploadUrl).toContain(`staging/t1/${id}`);
    await putToPresigned(initiated.uploadUrl, bytes, "application/octet-stream");
    expect(mock.store.has(`staging/t1/${id}`)).toBe(true);

    const confirmed = await runtime.runPromise(engine.confirm(id));
    expect(confirmed.status).toBe("ready");
    expect(confirmed.storageKey).toBe(`items/t1/${id}`);

    expect(mock.store.has(`items/t1/${id}`)).toBe(true);
    expect(mock.store.has(`staging/t1/${id}`)).toBe(false);

    const dl = await runtime.runPromise(engine.download(id));
    expect(dl.url).toContain(`items/t1/${id}`);
    expect(new TextDecoder().decode(await getFromPresigned(dl.url))).toBe("immutable bytes");
  });

  it("replaying a staging URL cannot alter a ready item", async () => {
    const original = new TextEncoder().encode("ORIGINAL");
    const tampered = new TextEncoder().encode("TAMPERED!");
    const engine = makeKevaEngine(principal);

    const initiated = await runtime.runPromise(
      engine.initiate({
        name: "x",
        contentType: "text/plain",
        size: original.byteLength,
        source: "upload",
        properties: {},
      }),
    );
    const { id } = initiated.item;

    await putToPresigned(initiated.uploadUrl, original, "text/plain");
    await runtime.runPromise(engine.confirm(id));

    await putToPresigned(initiated.uploadUrl, tampered, "text/plain");

    const dl = await runtime.runPromise(engine.download(id));
    expect(new TextDecoder().decode(await getFromPresigned(dl.url))).toBe("ORIGINAL");
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
          storageKey: `items/t1/${id}`,
          stagingKey: `staging/t1/${id}`,
          createdAt: timestamp,
          updatedAt: timestamp,
          properties: {},
        }),
      ),
    );
    await putToPresigned(`${mock.endpoint}/${mock.bucket}/staging/t1/${id}`, bytes, "text/plain");
    expect(mock.store.has(`staging/t1/${id}`)).toBe(true);

    const reaped = await runtime.runPromise(reapPending({ pendingTtlMs: 1 }));
    expect(reaped).toBe(1);

    const swept = await runtime.runPromise(sweepDeleting());
    expect(swept).toBe(1);

    const found = await runtime.runPromise(Effect.flatMap(MetadataStore, (m) => m.get("t1", id)));
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
        properties: {},
      }),
    );
    const { id } = initiated.item;
    await putToPresigned(initiated.uploadUrl, bytes, "text/plain");
    await runtime.runPromise(engine.confirm(id));
    expect(mock.store.has(`items/t1/${id}`)).toBe(true);

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

    expect(mock.store.has(`items/t1/${id}`)).toBe(false);
    const found = await runtime.runPromise(Effect.flatMap(MetadataStore, (m) => m.get("t1", id)));
    expect(found).toBeNull();
  });
});

describe.skipIf(!realS3Config)("S3 blob store against a real S3-compatible provider", () => {
  let runtime: ManagedRuntime.ManagedRuntime<BlobStore | MetadataStore, never>;

  beforeEach(() => {
    runtime = ManagedRuntime.make(
      Layer.merge(MemoryMetadataStoreLive, S3BlobStoreLive(realS3Config!)),
    );
  });

  afterEach(async () => {
    await runtime.runPromise(sweepDeleting()).catch(() => undefined);
    await runtime.dispose();
  });

  it("uploads, confirms, downloads, and deletes via signed provider requests", async () => {
    const bytes = new TextEncoder().encode(`real-s3-${crypto.randomUUID()}`);
    const engine = makeKevaEngine({
      ...principal,
      tenantId: `test-${crypto.randomUUID()}`,
    });

    const initiated = await runtime.runPromise(
      engine.initiate({
        name: "real-provider.txt",
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      }),
    );
    await putToPresigned(initiated.uploadUrl, bytes, "text/plain");

    const confirmed = await runtime.runPromise(engine.confirm(initiated.item.id));
    expect(confirmed.status).toBe("ready");

    const download = await runtime.runPromise(engine.download(confirmed.id));
    expect(await getFromPresigned(download.url)).toEqual(bytes);

    await runtime.runPromise(engine.delete(confirmed.id));
    await runtime.runPromise(sweepDeleting());
    const deleted = await runtime.runPromise(
      Effect.flatMap(MetadataStore, (metadata) => metadata.get(confirmed.tenantId, confirmed.id)),
    );
    expect(deleted).toBeNull();
  });
});
