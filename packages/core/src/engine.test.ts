import type { Principal } from "@keva/schema";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { makeKevaEngine, reapPending, sweepDeleting } from "./engine.js";
import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "./memory.js";
import { BlobStore, MetadataStore } from "./services.js";

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

const upload = (
  tenantId: string,
  name: string,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    const engine = makeKevaEngine(principal(tenantId));
    const initiated = yield* engine.initiate({
      name,
      contentType: "text/plain",
      size: bytes.byteLength,
      source: "upload",
      attributes: {},
    });
    const url = new URL(initiated.uploadUrl);
    const blobs = yield* BlobStore;
    yield* blobs.devPut!(
      initiated.object.stagingKey,
      bytes,
      "text/plain",
      url.searchParams.get("token")!,
    );
    return yield* engine.confirm(initiated.object.id);
  });

describe("KevaEngine", () => {
  it("runs an upload/query/download roundtrip with tenant isolation", async () => {
    const layer = Layer.merge(
      MemoryMetadataStoreLive,
      MemoryBlobStoreLive(),
    );
    const program = Effect.gen(function* () {
      const object = yield* upload(
        "tenant-a",
        "hello.txt",
        new TextEncoder().encode("hello"),
      );
      const own = yield* makeKevaEngine(principal("tenant-a")).query({
        where: [{ key: "name", op: "eq", value: "hello.txt" }],
        limit: 100,
      });
      const other = yield* makeKevaEngine(principal("tenant-b")).query({
        where: [],
        limit: 100,
      });
      return { object, own, other };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.object.status).toBe("ready");
    expect(result.own.objects).toHaveLength(1);
    expect(result.other.objects).toHaveLength(0);
  });

  it("does not overwrite final bytes when a staging grant is replayed", async () => {
    const layer = Layer.merge(
      MemoryMetadataStoreLive,
      MemoryBlobStoreLive(),
    );
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const first = new TextEncoder().encode("first");
      const initiated = yield* engine.initiate({
        name: "immutable.txt",
        contentType: "text/plain",
        size: first.byteLength,
        source: "upload",
        attributes: {},
      });
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(
        initiated.object.stagingKey,
        first,
        "text/plain",
        token,
      );
      yield* engine.confirm(initiated.object.id);
      yield* blobs.devPut!(
        initiated.object.stagingKey,
        new TextEncoder().encode("other"),
        "text/plain",
        token,
      );
      yield* engine.confirm(initiated.object.id);
      const final = yield* blobs.head(initiated.object.storageKey);
      const staged = yield* blobs.head(initiated.object.stagingKey);
      return { final, staged };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.final?.etag).not.toBe(result.staged?.etag);
  });

  it("reaps pending records and sweeps deleting records", async () => {
    const layer = Layer.merge(
      MemoryMetadataStoreLive,
      MemoryBlobStoreLive(),
    );
    const program = Effect.gen(function* () {
      const metadata = yield* MetadataStore;
      const timestamp = new Date(Date.now() - 10_000).toISOString();
      yield* metadata.insert({
        id: crypto.randomUUID(),
        tenantId: "tenant-a",
        name: "abandoned",
        contentType: "text/plain",
        declaredSize: 1,
        size: null,
        etag: null,
        checksum: null,
        source: "upload",
        status: "pending",
        storageKey: "objects/tenant-a/abandoned",
        stagingKey: "staging/tenant-a/abandoned",
        createdAt: timestamp,
        updatedAt: timestamp,
        attributes: {},
      });
      const reaped = yield* reapPending({ pendingTtlMs: 1 });
      const swept = yield* sweepDeleting();
      return { reaped, swept };
    }).pipe(Effect.provide(layer));

    await expect(Effect.runPromise(program)).resolves.toEqual({
      reaped: 1,
      swept: 1,
    });
  });

  it("enforces scopes: a read-only principal cannot write", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const readonly: Principal = {
      tenantId: "tenant-a",
      scopes: ["read"],
      via: "token",
    };
    const program = Effect.either(
      makeKevaEngine(readonly).initiate({
        name: "x",
        contentType: "text/plain",
        size: 1,
        source: "upload",
        attributes: {},
      }),
    ).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("Forbidden");
  });

  it("is idempotent: confirming a ready object twice returns the same object", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const bytes = new TextEncoder().encode("idem");
      const initiated = yield* engine.initiate({
        name: "idem.txt",
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        attributes: {},
      });
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(
        initiated.object.stagingKey,
        bytes,
        "text/plain",
        token,
      );
      const first = yield* engine.confirm(initiated.object.id);
      const second = yield* engine.confirm(initiated.object.id);
      return { first, second };
    }).pipe(Effect.provide(layer));

    const { first, second } = await Effect.runPromise(program);
    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
  });

  it("is tenant-scoped: another tenant cannot get the object (NotFound)", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const owner = yield* upload(
        "owner",
        "secret.bin",
        new TextEncoder().encode("secret"),
      );
      const intruderGet = yield* Effect.either(
        makeKevaEngine(principal("intruder")).get(owner.id),
      );
      return { intruderGet };
    }).pipe(Effect.provide(layer));

    const { intruderGet } = await Effect.runPromise(program);
    expect(intruderGet._tag).toBe("Left");
    if (intruderGet._tag === "Left") {
      expect(intruderGet.left._tag).toBe("NotFound");
    }
  });

  it("writes attributes and serves eq + contains membership queries", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const object = yield* upload(
        "tenant-a",
        "notes.txt",
        new TextEncoder().encode("hello keva"),
      );
      yield* engine.patchAttributes(object.id, {
        set: { location: "bali", rating: 5, tags: ["diving", "summer"] },
        unset: [],
      });
      const byLocation = yield* engine.query({
        where: [{ key: "location", op: "eq", value: "bali" }],
        limit: 100,
      });
      const byTag = yield* engine.query({
        where: [{ key: "tags", op: "contains", value: "diving" }],
        limit: 100,
      });
      const fetched = yield* engine.get(object.id);
      return { byLocation, byTag, fetched };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.byLocation.objects).toHaveLength(1);
    expect(result.byTag.objects).toHaveLength(1);
    expect(result.fetched.attributes).toEqual({
      location: "bali",
      rating: 5,
      tags: ["diving", "summer"],
    });
  });
});
