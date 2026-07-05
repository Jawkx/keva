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

type ShareOptions = {
  readonly scopes?: Principal["scopes"];
  readonly grantId?: string;
  readonly conditions?: NonNullable<Principal["share"]>["conditions"];
  readonly writeStamp?: NonNullable<Principal["share"]>["writeStamp"];
  readonly limits?: NonNullable<Principal["share"]>["limits"];
};

const sharePrincipal = (tenantId: string, options: ShareOptions = {}): Principal => ({
  tenantId,
  scopes: options.scopes ?? ["read"],
  via: "share",
  share: {
    grantId: options.grantId ?? "grant-1",
    conditions: options.conditions ?? [{ key: "project", op: "eq", value: "alpha" }],
    ...(options.writeStamp === undefined ? {} : { writeStamp: options.writeStamp }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  },
});

// Upload through a share principal (initiate → devPut → confirm), returning the
// confirmed item. Mirrors `upload` but drives the share write path.
const shareUpload = (p: Principal, name: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const engine = makeKevaEngine(p);
    const initiated = yield* engine.initiate({
      name,
      contentType: "text/plain",
      size: bytes.byteLength,
      source: "upload",
      properties: {},
    });
    const url = new URL(initiated.uploadUrl);
    const blobs = yield* BlobStore;
    yield* blobs.devPut!(
      initiated.item.stagingKey,
      bytes,
      "text/plain",
      url.searchParams.get("token")!,
    );
    return yield* engine.confirm(initiated.item.id);
  });

const upload = (tenantId: string, name: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const engine = makeKevaEngine(principal(tenantId));
    const initiated = yield* engine.initiate({
      name,
      contentType: "text/plain",
      size: bytes.byteLength,
      source: "upload",
      properties: {},
    });
    const url = new URL(initiated.uploadUrl);
    const blobs = yield* BlobStore;
    yield* blobs.devPut!(
      initiated.item.stagingKey,
      bytes,
      "text/plain",
      url.searchParams.get("token")!,
    );
    return yield* engine.confirm(initiated.item.id);
  });

describe("KevaEngine", () => {
  it("runs an upload/query/download roundtrip with tenant isolation", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const item = yield* upload("tenant-a", "hello.txt", new TextEncoder().encode("hello"));
      const own = yield* makeKevaEngine(principal("tenant-a")).query({
        where: [{ key: "name", op: "eq", value: "hello.txt" }],
        limit: 100,
        order: "created_at_asc",
      });
      const other = yield* makeKevaEngine(principal("tenant-b")).query({
        where: [],
        limit: 100,
        order: "created_at_asc",
      });
      return { item, own, other };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.item.status).toBe("ready");
    expect(result.own.items).toHaveLength(1);
    expect(result.other.items).toHaveLength(0);
  });

  it("searches ready items by name and content type with tenant-scoped pagination", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const tenant = makeKevaEngine(principal("tenant-a"));
      const named = yield* upload("tenant-a", "quarterly-fox.txt", new TextEncoder().encode("one"));
      const typed = yield* tenant.initiate({
        name: "diagram.svg",
        contentType: "image/fox-icon",
        size: 3,
        source: "upload",
        properties: {},
      });
      const token = new URL(typed.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(
        typed.item.stagingKey,
        new TextEncoder().encode("two"),
        "image/fox-icon",
        token,
      );
      const contentTypeMatch = yield* tenant.confirm(typed.item.id);
      yield* upload("tenant-a", "plain.txt", new TextEncoder().encode("three"));
      yield* upload("tenant-b", "other-fox.txt", new TextEncoder().encode("four"));

      const all = yield* tenant.query({
        where: [],
        search: "fox",
        limit: 100,
        order: "created_at_asc",
      });
      const firstPage = yield* tenant.query({
        where: [],
        search: "fox",
        limit: 1,
        order: "created_at_asc",
      });
      const secondPage = yield* tenant.query({
        where: [],
        search: "fox",
        limit: 1,
        order: "created_at_asc",
        cursor: firstPage.nextCursor,
      });
      const otherTenant = yield* makeKevaEngine(principal("tenant-b")).query({
        where: [],
        search: "quarterly",
        limit: 100,
        order: "created_at_asc",
      });
      return { named, contentTypeMatch, all, firstPage, secondPage, otherTenant };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.all.items.map((item) => item.id).sort()).toEqual(
      [result.named.id, result.contentTypeMatch.id].sort(),
    );
    expect(result.firstPage.items).toHaveLength(1);
    expect(result.secondPage.items).toHaveLength(1);
    expect(new Set([result.firstPage.items[0]!.id, result.secondPage.items[0]!.id])).toEqual(
      new Set([result.named.id, result.contentTypeMatch.id]),
    );
    expect(result.otherTenant.items).toHaveLength(0);
  });

  it("does not overwrite final bytes when a staging grant is replayed", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const first = new TextEncoder().encode("first");
      const initiated = yield* engine.initiate({
        name: "immutable.txt",
        contentType: "text/plain",
        size: first.byteLength,
        source: "upload",
        properties: {},
      });
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(initiated.item.stagingKey, first, "text/plain", token);
      yield* engine.confirm(initiated.item.id);
      yield* blobs.devPut!(
        initiated.item.stagingKey,
        new TextEncoder().encode("other"),
        "text/plain",
        token,
      );
      yield* engine.confirm(initiated.item.id);
      const final = yield* blobs.head(initiated.item.storageKey);
      const staged = yield* blobs.head(initiated.item.stagingKey);
      return { final, staged };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.final?.etag).not.toBe(result.staged?.etag);
  });

  it("reaps pending records and sweeps deleting records", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
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
        storageKey: "items/tenant-a/abandoned",
        stagingKey: "staging/tenant-a/abandoned",
        createdAt: timestamp,
        updatedAt: timestamp,
        properties: {},
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
        properties: {},
      }),
    ).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("Forbidden");
  });

  it("is idempotent: confirming a ready item twice returns the same item", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const bytes = new TextEncoder().encode("idem");
      const initiated = yield* engine.initiate({
        name: "idem.txt",
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(initiated.item.stagingKey, bytes, "text/plain", token);
      const first = yield* engine.confirm(initiated.item.id);
      const second = yield* engine.confirm(initiated.item.id);
      return { first, second };
    }).pipe(Effect.provide(layer));

    const { first, second } = await Effect.runPromise(program);
    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
  });

  it("is tenant-scoped: another tenant cannot get the item (NotFound)", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const owner = yield* upload("owner", "secret.bin", new TextEncoder().encode("secret"));
      const intruderGet = yield* Effect.either(makeKevaEngine(principal("intruder")).get(owner.id));
      return { intruderGet };
    }).pipe(Effect.provide(layer));

    const { intruderGet } = await Effect.runPromise(program);
    expect(intruderGet._tag).toBe("Left");
    if (intruderGet._tag === "Left") {
      expect(intruderGet.left._tag).toBe("NotFound");
    }
  });

  it("writes properties and serves eq + contains membership queries", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const item = yield* upload("tenant-a", "notes.txt", new TextEncoder().encode("hello keva"));
      yield* engine.patch(item.id, {
        set: { location: "bali", rating: 5, tags: ["diving", "summer"] },
        unset: [],
      });
      const byLocation = yield* engine.query({
        where: [{ key: "location", op: "eq", value: "bali" }],
        limit: 100,
        order: "created_at_asc",
      });
      const byTag = yield* engine.query({
        where: [{ key: "tags", op: "contains", value: "diving" }],
        limit: 100,
        order: "created_at_asc",
      });
      const fetched = yield* engine.get(item.id);
      return { byLocation, byTag, fetched };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.byLocation.items).toHaveLength(1);
    expect(result.byTag.items).toHaveLength(1);
    expect(result.fetched.properties).toEqual({
      location: "bali",
      rating: 5,
      tags: ["diving", "summer"],
    });
  });

  it("aggregates distinct property keys and scalar values per tenant", async () => {
    const layer = Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const one = yield* upload("tenant-a", "a.txt", new TextEncoder().encode("a"));
      const two = yield* upload("tenant-a", "b.txt", new TextEncoder().encode("b"));
      yield* engine.patch(one.id, {
        set: { location: "bali", rating: 5, tags: ["x"] },
        unset: [],
      });
      yield* engine.patch(two.id, { set: { location: "tokyo", rating: 5 }, unset: [] });
      // A second tenant's keys and values must not leak into the aggregation.
      const other = yield* upload("tenant-b", "c.txt", new TextEncoder().encode("c"));
      yield* makeKevaEngine(principal("tenant-b")).patch(other.id, {
        set: { secret: "nope" },
        unset: [],
      });

      return {
        keys: yield* engine.propertyKeys(),
        locations: yield* engine.propertyValues("location"),
        ratings: yield* engine.propertyValues("rating"),
        tags: yield* engine.propertyValues("tags"),
      };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    // Sorted, distinct, tenant-scoped (no "secret" from tenant-b).
    expect(result.keys).toEqual({ keys: ["location", "rating", "tags"] });
    expect(result.locations).toEqual({ values: ["bali", "tokyo"] });
    // Duplicate scalar values collapse to one.
    expect(result.ratings).toEqual({ values: [5] });
    // Array-valued properties are excluded — they can't seed a single-line input.
    expect(result.tags).toEqual({ values: [] });
  });
});

describe("KevaEngine share access", () => {
  const layer = () => Layer.merge(MemoryMetadataStoreLive, MemoryBlobStoreLive());

  // Seed two ready items in tenant-a, tagged project=alpha and project=beta.
  const seedTagged = () =>
    Effect.gen(function* () {
      const owner = makeKevaEngine(principal("tenant-a"));
      const alpha = yield* upload("tenant-a", "alpha.txt", new TextEncoder().encode("a"));
      const beta = yield* upload("tenant-a", "beta.txt", new TextEncoder().encode("b"));
      yield* owner.patch(alpha.id, { set: { project: "alpha" }, unset: [] });
      yield* owner.patch(beta.id, { set: { project: "beta" }, unset: [] });
      return { alpha, beta };
    });

  it("scopes a share query to the grant conditions and never widens it", async () => {
    const program = Effect.gen(function* () {
      yield* seedTagged();
      const share = makeKevaEngine(sharePrincipal("tenant-a"));
      const all = yield* share.query({ where: [], limit: 100, order: "created_at_asc" });
      // A visitor condition only narrows further within the shared view.
      const widen = yield* share.query({
        where: [{ key: "project", op: "eq", value: "beta" }],
        limit: 100,
        order: "created_at_asc",
      });
      return { all, widen };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.all.items.map((item) => item.name)).toEqual(["alpha.txt"]);
    expect(result.widen.items).toHaveLength(0);
  });

  it("with empty conditions, a share sees every item in the tenant", async () => {
    const program = Effect.gen(function* () {
      yield* seedTagged();
      const share = makeKevaEngine(sharePrincipal("tenant-a", { conditions: [] }));
      const all = yield* share.query({ where: [], limit: 100, order: "created_at_asc" });
      return all.items.map((item) => item.name).sort();
    }).pipe(Effect.provide(layer()));

    expect(await Effect.runPromise(program)).toEqual(["alpha.txt", "beta.txt"]);
  });

  it("returns NotFound for get/download of an item outside the grant", async () => {
    const program = Effect.gen(function* () {
      const { alpha, beta } = yield* seedTagged();
      const share = makeKevaEngine(sharePrincipal("tenant-a"));
      const getMatch = yield* share.get(alpha.id);
      const getOutside = yield* Effect.either(share.get(beta.id));
      const downloadMatch = yield* Effect.either(share.download(alpha.id));
      const downloadOutside = yield* Effect.either(share.download(beta.id));
      return { getMatch, getOutside, downloadMatch, downloadOutside };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.getMatch.id).toBeDefined();
    expect(result.getOutside._tag).toBe("Left");
    if (result.getOutside._tag === "Left") expect(result.getOutside.left._tag).toBe("NotFound");
    expect(result.downloadMatch._tag).toBe("Right");
    expect(result.downloadOutside._tag).toBe("Left");
    if (result.downloadOutside._tag === "Left")
      expect(result.downloadOutside.left._tag).toBe("NotFound");
  });

  it("force-applies the write stamp and share source, ignoring caller input", async () => {
    const program = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        writeStamp: { project: "alpha" },
      });
      const item = yield* shareUpload(p, "drop.txt", new TextEncoder().encode("x"));
      // The stamped item is visible back through the same grant.
      const listed = yield* makeKevaEngine(p).query({
        where: [],
        limit: 100,
        order: "created_at_asc",
      });
      return { item, listed };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.item.source).toBe("share:grant-1");
    expect(result.item.properties).toEqual({ project: "alpha" });
    expect(result.listed.items.map((i) => i.id)).toContain(result.item.id);
  });

  it("rejects caller-supplied properties or source on a share upload", async () => {
    const program = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        writeStamp: { project: "alpha" },
      });
      const withProps = yield* Effect.either(
        makeKevaEngine(p).initiate({
          name: "x",
          contentType: "text/plain",
          size: 1,
          source: "upload",
          properties: { sneaky: "yes" },
        }),
      );
      const withSource = yield* Effect.either(
        makeKevaEngine(p).initiate({
          name: "x",
          contentType: "text/plain",
          size: 1,
          source: "elsewhere",
          properties: {},
        }),
      );
      return { withProps, withSource };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.withProps._tag).toBe("Left");
    if (result.withProps._tag === "Left")
      expect(result.withProps.left._tag).toBe("ValidationError");
    expect(result.withSource._tag).toBe("Left");
    if (result.withSource._tag === "Left")
      expect(result.withSource.left._tag).toBe("ValidationError");
  });

  it("rejects a non-share caller reusing the reserved share: source prefix", async () => {
    const program = Effect.either(
      makeKevaEngine(principal("tenant-a")).initiate({
        name: "x",
        contentType: "text/plain",
        size: 1,
        source: "share:grant-1",
        properties: {},
      }),
    ).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("ValidationError");
  });

  it("enforces the per-file, item-count, and total-byte quotas", async () => {
    const stamp = { project: "alpha" } as const;
    const perFile = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        writeStamp: stamp,
        limits: { maxItemBytes: 3, maxTotalBytes: null, maxItems: null },
      });
      return yield* Effect.either(
        makeKevaEngine(p).initiate({
          name: "big",
          contentType: "text/plain",
          size: 5,
          source: "upload",
          properties: {},
        }),
      );
    }).pipe(Effect.provide(layer()));

    // maxItems=1: a single *pending* (unconfirmed) initiate must already exhaust
    // the count quota, proving pending items count toward usage.
    const itemCount = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        writeStamp: stamp,
        limits: { maxItemBytes: null, maxTotalBytes: null, maxItems: 1 },
      });
      const engine = makeKevaEngine(p);
      yield* engine.initiate({
        name: "one",
        contentType: "text/plain",
        size: 1,
        source: "upload",
        properties: {},
      });
      return yield* Effect.either(
        engine.initiate({
          name: "two",
          contentType: "text/plain",
          size: 1,
          source: "upload",
          properties: {},
        }),
      );
    }).pipe(Effect.provide(layer()));

    const totalBytes = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        writeStamp: stamp,
        limits: { maxItemBytes: null, maxTotalBytes: 5, maxItems: null },
      });
      yield* shareUpload(p, "three.txt", new TextEncoder().encode("abc")); // 3 bytes ready
      return yield* Effect.either(
        makeKevaEngine(p).initiate({
          name: "more",
          contentType: "text/plain",
          size: 3, // 3 + 3 > 5
          source: "upload",
          properties: {},
        }),
      );
    }).pipe(Effect.provide(layer()));

    for (const outcome of await Promise.all([
      Effect.runPromise(perFile),
      Effect.runPromise(itemCount),
      Effect.runPromise(totalBytes),
    ])) {
      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") expect(outcome.left._tag).toBe("QuotaExceeded");
    }
  });

  it("hides items from other grants when confirming", async () => {
    const program = Effect.gen(function* () {
      const grant1 = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        grantId: "grant-1",
        writeStamp: { project: "alpha" },
      });
      // grant-1 initiates but does not confirm — item is pending, source share:grant-1.
      const initiated = yield* makeKevaEngine(grant1).initiate({
        name: "pending.txt",
        contentType: "text/plain",
        size: 1,
        source: "upload",
        properties: {},
      });
      const grant2 = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        grantId: "grant-2",
        writeStamp: { project: "alpha" },
      });
      return yield* Effect.either(makeKevaEngine(grant2).confirm(initiated.item.id));
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("NotFound");
  });

  it("forbids patch, delete, usage, and property autocomplete for shares", async () => {
    const program = Effect.gen(function* () {
      const { alpha } = yield* seedTagged();
      const p = sharePrincipal("tenant-a", { scopes: ["read", "write", "delete"] });
      const engine = makeKevaEngine(p);
      return {
        patch: yield* Effect.either(engine.patch(alpha.id, { set: { x: 1 }, unset: [] })),
        del: yield* Effect.either(engine.delete(alpha.id)),
        usage: yield* Effect.either(engine.usage()),
        keys: yield* Effect.either(engine.propertyKeys()),
        values: yield* Effect.either(engine.propertyValues("project")),
      };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    for (const outcome of Object.values(result)) {
      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") expect(outcome.left._tag).toBe("Forbidden");
    }
  });
});
