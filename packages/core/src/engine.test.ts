import { testEffect } from "@keva/effect-test";
import { StorageUnavailable, type Principal, type SharePrincipal } from "@keva/schema";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canDeleteOwnShareUpload, makeKevaEngine, reapPending, sweepDeleting } from "./engine.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { S3BlobStoreLive } from "./s3.js";
import { BlobStore, MetadataStore, type BlobStoreService } from "./services.js";
import { testSql } from "./test/db.js";
import { putObject, s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";

const sql = testSql();
let mock: S3Mock;
beforeAll(async () => {
  mock = await startS3Mock();
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await mock.close();
});

const testLayer = () =>
  Layer.merge(
    Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
    S3BlobStoreLive(s3MockConfig(mock)),
  );

const lifecycleBlobs: BlobStoreService = {
  presignUpload: () => Effect.die("not used"),
  presignDownload: () => Effect.die("not used"),
  head: () => Effect.die("not used"),
  copy: () => Effect.die("not used"),
  delete: (key) =>
    key.includes("poison")
      ? Effect.fail(new StorageUnavailable({ message: "Blob storage unavailable" }))
      : Effect.void,
};

const lifecycleIt = testEffect(
  Layer.merge(
    Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
    Layer.succeed(BlobStore, lifecycleBlobs),
  ),
);

const stage = (key: string, bytes: Uint8Array, contentType: string) =>
  Effect.promise(() => putObject(mock, key, bytes, contentType));

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

type ShareOptions = {
  readonly scopes?: Principal["scopes"];
  readonly grantId?: string;
  readonly conditions?: SharePrincipal["share"]["conditions"];
  readonly writeStamp?: SharePrincipal["share"]["writeStamp"];
  readonly allowOwnDelete?: boolean;
  readonly user?: { readonly id: string; readonly name: string };
  readonly limits?: SharePrincipal["share"]["limits"];
};

const sharePrincipal = (tenantId: string, options: ShareOptions = {}): Principal => ({
  tenantId,
  scopes: options.scopes ?? ["read"],
  via: "share",
  ...(options.user
    ? {
        actor: {
          user: options.user,
          share: { grantId: options.grantId ?? "grant-1", name: "Test share" },
        },
      }
    : {}),
  share: {
    grantId: options.grantId ?? "grant-1",
    ...(options.user ? { identityId: options.user.id } : {}),
    conditions: options.conditions ?? [{ key: "project", op: "has_value", value: "alpha" }],
    ...(options.writeStamp === undefined ? {} : { writeStamp: options.writeStamp }),
    allowOwnDelete: options.allowOwnDelete ?? false,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  },
});

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
    yield* stage(initiated.item.stagingKey, bytes, "text/plain");
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
    yield* stage(initiated.item.stagingKey, bytes, "text/plain");
    return yield* engine.confirm(initiated.item.id);
  });

describe("KevaEngine", () => {
  it("reserves quota for pending uploads and releases it on deletion", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const metadata = yield* MetadataStore;
      const engine = makeKevaEngine(principal("tenant-a"));
      yield* metadata.setQuota("tenant-a", 5);
      const first = yield* engine.initiate({
        name: "first.txt",
        contentType: "text/plain",
        size: 4,
        source: "upload",
        properties: {},
      });
      const rejected = yield* Effect.flip(
        engine.initiate({
          name: "too-large.txt",
          contentType: "text/plain",
          size: 2,
          source: "upload",
          properties: {},
        }),
      );
      yield* engine.delete(first.item.id);
      const afterDelete = yield* engine.initiate({
        name: "after-delete.txt",
        contentType: "text/plain",
        size: 2,
        source: "upload",
        properties: {},
      });
      return { rejected, afterDelete, usage: yield* engine.usage() };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.rejected).toMatchObject({
      _tag: "QuotaExceeded",
      message: "Storage limit reached",
    });
    expect(result.afterDelete.item.status).toBe("pending");
    expect(result.usage).toMatchObject({ quotaBytes: 5, remainingBytes: 3 });
  });

  it("runs an upload/query/download roundtrip with tenant isolation", async () => {
    const layer = testLayer();
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

  it("does not overwrite final bytes when a staging grant is replayed", async () => {
    const layer = testLayer();
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
      const blobs = yield* BlobStore;
      yield* stage(initiated.item.stagingKey, first, "text/plain");
      yield* engine.confirm(initiated.item.id);
      yield* stage(initiated.item.stagingKey, new TextEncoder().encode("other"), "text/plain");
      yield* engine.confirm(initiated.item.id);
      const final = yield* blobs.head(initiated.item.storageKey);
      const staged = yield* blobs.head(initiated.item.stagingKey);
      return { final, staged };
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result.final?.etag).not.toBe(result.staged?.etag);
  });

  it("reaps pending records and sweeps deleting records", async () => {
    const layer = testLayer();
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
        source: "upload",
        status: "pending",
        storageKey: "items/tenant-a/abandoned",
        stagingKey: "staging/tenant-a/abandoned",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        properties: {},
      });
      const reaped = yield* reapPending({ pendingTtlMs: 1 });
      const swept = yield* sweepDeleting();
      return { reaped, swept };
    }).pipe(Effect.provide(layer));

    await expect(Effect.runPromise(program)).resolves.toEqual({
      reaped: { completed: 1, failed: 0 },
      swept: { completed: 1, failed: 0 },
    });
  });

  it("enforces scopes: a read-only principal cannot write", async () => {
    const layer = testLayer();
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
    const layer = testLayer();
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
      yield* stage(initiated.item.stagingKey, bytes, "text/plain");
      const first = yield* engine.confirm(initiated.item.id);
      const second = yield* engine.confirm(initiated.item.id);
      return { first, second };
    }).pipe(Effect.provide(layer));

    const { first, second } = await Effect.runPromise(program);
    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
  });

  it("is tenant-scoped: another tenant cannot get the item (NotFound)", async () => {
    const layer = testLayer();
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

  it("writes properties and serves value membership queries", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const item = yield* upload("tenant-a", "notes.txt", new TextEncoder().encode("hello keva"));
      yield* engine.patch(item.id, {
        set: { location: "bali", rating: "five", tags: ["summer", "diving"] },
        unset: [],
      });
      const byLocation = yield* engine.query({
        where: [{ key: "location", op: "has_value", value: "bali" }],
        limit: 100,
        order: "created_at_asc",
      });
      const byTag = yield* engine.query({
        where: [{ key: "tags", op: "has_value", value: "diving" }],
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
      rating: "five",
      tags: ["diving", "summer"],
    });
  });

  it("aggregates distinct property keys and scalar values per tenant", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const one = yield* upload("tenant-a", "a.txt", new TextEncoder().encode("a"));
      const two = yield* upload("tenant-a", "b.txt", new TextEncoder().encode("b"));
      yield* engine.patch(one.id, {
        set: { location: "bali", rating: "five", tags: ["x"] },
        unset: [],
      });
      yield* engine.patch(two.id, { set: { location: "tokyo", rating: "five" }, unset: [] });
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
    expect(result.keys).toEqual({ keys: ["location", "rating", "tags"] });
    expect(result.locations).toEqual({ values: ["bali", "tokyo"] });
    expect(result.ratings).toEqual({ values: ["five"] });
    expect(result.tags).toEqual({ values: ["x"] });
  });

  it("summarizes per-key value shapes, surfacing bare nulls as tags", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(principal("tenant-a"));
      const one = yield* upload("tenant-a", "a.txt", new TextEncoder().encode("a"));
      const two = yield* upload("tenant-a", "b.txt", new TextEncoder().encode("b"));
      yield* engine.patch(one.id, {
        set: { logo: null, project: "keva", rating: "five", tags: ["x"] },
        unset: [],
      });
      yield* engine.patch(two.id, { set: { project: null, reviewed: "yes" }, unset: [] });
      return yield* engine.propertySummary();
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toEqual({
      entries: [
        { key: "logo", kinds: ["tag"], values: [] },
        { key: "project", kinds: ["string", "tag"], values: ["keva"] },
        { key: "rating", kinds: ["string"], values: ["five"] },
        { key: "reviewed", kinds: ["string"], values: ["yes"] },
        { key: "tags", kinds: ["array"], values: ["x"] },
      ],
    });
  });
});

describe("lifecycle batches", () => {
  lifecycleIt.effect(
    "continues after a poisoned item and reports the partial failure",
    Effect.gen(function* () {
      const metadata = yield* MetadataStore;
      const timestamp = new Date(0).toISOString();
      for (const name of ["poison", "healthy"]) {
        yield* metadata.insert({
          id: crypto.randomUUID(),
          tenantId: "tenant-lifecycle",
          name,
          contentType: "text/plain",
          declaredSize: 1,
          size: 1,
          etag: null,
          source: "upload",
          status: "deleting",
          storageKey: `items/tenant-lifecycle/${name}`,
          stagingKey: `staging/tenant-lifecycle/${name}`,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          properties: {},
        });
      }

      const result = yield* sweepDeleting({ concurrency: 2 });
      const remaining = yield* metadata.listByStatus("deleting", 10);

      expect(result).toEqual({ completed: 1, failed: 1 });
      expect(remaining.map((item) => item.name)).toEqual(["poison"]);
    }),
  );
});

describe("KevaEngine item history", () => {
  const layer = () => testLayer();

  const actorPrincipal: Principal = {
    tenantId: "tenant-a",
    scopes: ["read", "write", "delete", "admin"],
    via: "token",
    actor: { token: { id: "tok-1", name: "CI token" } },
  };

  it("records the full lifecycle with actor snapshots and diffs, newest-first", async () => {
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(actorPrincipal);
      const bytes = new TextEncoder().encode("history");
      const initiated = yield* engine.initiate({
        name: "report.txt",
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      yield* stage(initiated.item.stagingKey, bytes, "text/plain");
      yield* engine.confirm(initiated.item.id);
      yield* engine.confirm(initiated.item.id);
      // Same-millisecond events tie-break on a random id; sleeps keep the
      // expected order deterministic.
      yield* Effect.sleep(2);
      yield* engine.patch(initiated.item.id, { set: { name: "final.txt" }, unset: [] });
      yield* Effect.sleep(2);
      yield* engine.patch(initiated.item.id, { set: { priority: "high" }, unset: [] });
      yield* Effect.sleep(2);
      yield* engine.patch(initiated.item.id, {
        set: { priority: "high", status2: "done" },
        unset: ["priority"],
      });
      yield* Effect.sleep(2);
      yield* engine.delete(initiated.item.id);
      const events = yield* engine.events(initiated.item.id);
      const otherTenant = yield* makeKevaEngine(principal("tenant-b")).events(initiated.item.id);
      return { ...events, otherTenant };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.otherTenant.events).toHaveLength(0);
    expect(result.events.map((event) => event.action)).toEqual([
      "deleted",
      "updated",
      "updated",
      "updated",
      "uploaded",
    ]);
    const [deleted, second, first, renamed, uploaded] = result.events;
    for (const event of result.events) {
      expect(event.actor).toEqual({ token: { id: "tok-1", name: "CI token" } });
      expect(event.tenantId).toBe("tenant-a");
    }
    expect(uploaded!.payload).toEqual({
      size: 7,
      contentType: "text/plain",
      source: "upload",
    });
    expect(uploaded!.itemName).toBe("report.txt");
    expect(renamed!.payload).toEqual({ name: { from: "report.txt", to: "final.txt" } });
    expect(renamed!.itemName).toBe("final.txt");
    expect(first!.payload).toEqual({ properties: { set: { priority: "high" } } });
    expect(second!.payload).toEqual({
      properties: {
        set: { status2: "done" },
        previous: { priority: "high" },
        unset: ["priority"],
      },
    });
    expect(deleted!.payload).toEqual({});
  });

  it("paginates events with a keyset cursor", async () => {
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(actorPrincipal);
      const item = yield* upload("tenant-a", "page.txt", new TextEncoder().encode("x"));
      yield* Effect.sleep(2);
      yield* engine.patch(item.id, { set: { a: "one" }, unset: [] });
      yield* Effect.sleep(2);
      yield* engine.patch(item.id, { set: { b: "two" }, unset: [] });
      const firstPage = yield* engine.events(item.id, { limit: 2 });
      const secondPage = yield* engine.events(item.id, {
        limit: 2,
        cursor: firstPage.nextCursor!,
      });
      return { firstPage, secondPage };
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.firstPage.events).toHaveLength(2);
    expect(result.firstPage.nextCursor).toBeDefined();
    expect(result.secondPage.events.map((event) => event.action)).toEqual(["uploaded"]);
    expect(result.secondPage.nextCursor).toBeUndefined();
    const ids = [...result.firstPage.events, ...result.secondPage.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("records no event for a fully no-op patch", async () => {
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(actorPrincipal);
      const item = yield* upload("tenant-a", "noop.txt", new TextEncoder().encode("x"));
      yield* Effect.sleep(2);
      yield* engine.patch(item.id, { set: { keep: "same" }, unset: [] });
      yield* Effect.sleep(2);
      yield* engine.patch(item.id, { set: { keep: "same" }, unset: ["never-existed"] });
      const { events } = yield* engine.events(item.id);
      return events.map((event) => event.action);
    }).pipe(Effect.provide(layer()));

    expect(await Effect.runPromise(program)).toEqual(["updated", "uploaded"]);
  });

  it("records a combined rename and property patch in one event", async () => {
    const program = Effect.gen(function* () {
      const engine = makeKevaEngine(actorPrincipal);
      const item = yield* upload("tenant-a", "draft.txt", new TextEncoder().encode("x"));
      yield* engine.patch(item.id, { set: { project: "alpha", draft: null }, unset: [] });
      yield* Effect.sleep(2);
      yield* engine.patch(item.id, {
        set: { name: "final.txt", project: "beta", reviewedBy: "alice" },
        unset: ["draft"],
      });
      return yield* engine.events(item.id);
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result.events[0]).toMatchObject({
      action: "updated",
      payload: {
        name: { from: "draft.txt", to: "final.txt" },
        properties: {
          set: { project: "beta", reviewedBy: "alice" },
          previous: { project: "alpha", draft: null },
          unset: ["draft"],
        },
      },
    });
  });
});

describe("KevaEngine share access", () => {
  const layer = () => testLayer();

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
      const widen = yield* share.query({
        where: [{ key: "project", op: "has_value", value: "beta" }],
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
        grantId: "grant-per-file",
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

    const itemCount = Effect.gen(function* () {
      const p = sharePrincipal("tenant-a", {
        scopes: ["read", "write"],
        grantId: "grant-item-count",
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
        grantId: "grant-total-bytes",
        writeStamp: stamp,
        limits: { maxItemBytes: null, maxTotalBytes: 5, maxItems: null },
      });
      yield* shareUpload(p, "three.txt", new TextEncoder().encode("abc"));
      return yield* Effect.either(
        makeKevaEngine(p).initiate({
          name: "more",
          contentType: "text/plain",
          size: 3,
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

  it("lets a share visitor trash only uploads attributed to their identity and grant", async () => {
    const program = Effect.gen(function* () {
      const uploader = sharePrincipal("tenant-own-delete", {
        scopes: ["read", "write"],
        grantId: "grant-own",
        writeStamp: { project: "alpha" },
        allowOwnDelete: true,
        user: { id: "user-a", name: "Uploader" },
      });
      const item = yield* shareUpload(uploader, "mine.txt", new TextEncoder().encode("mine"));
      const wrongUser = makeKevaEngine(
        sharePrincipal("tenant-own-delete", {
          scopes: ["read", "write"],
          grantId: "grant-own",
          writeStamp: { project: "alpha" },
          allowOwnDelete: true,
          user: { id: "user-b", name: "Someone else" },
        }),
      );
      const wrongGrant = makeKevaEngine(
        sharePrincipal("tenant-own-delete", {
          scopes: ["read", "write"],
          grantId: "grant-other",
          writeStamp: { project: "alpha" },
          allowOwnDelete: true,
          user: { id: "user-a", name: "Uploader" },
        }),
      );
      const disabled = makeKevaEngine(
        sharePrincipal("tenant-own-delete", {
          scopes: ["read", "write"],
          grantId: "grant-own",
          writeStamp: { project: "alpha" },
          user: { id: "user-a", name: "Uploader" },
        }),
      );
      const denied = {
        wrongUser: yield* Effect.either(wrongUser.deleteOwnShareUpload(item.id)),
        wrongGrant: yield* Effect.either(wrongGrant.deleteOwnShareUpload(item.id)),
        disabled: yield* Effect.either(disabled.deleteOwnShareUpload(item.id)),
      };
      yield* makeKevaEngine(uploader).deleteOwnShareUpload(item.id);
      const metadata = yield* MetadataStore;
      return {
        item,
        denied,
        deleted: yield* metadata.get("tenant-own-delete", item.id),
        canDelete: canDeleteOwnShareUpload(uploader, item),
      };
    }).pipe(Effect.provide(testLayer()));

    const result = await Effect.runPromise(program);
    expect(result.item.uploadedByUserId).toBe("user-a");
    expect(result.canDelete).toBe(true);
    expect(result.denied.wrongUser).toMatchObject({ _tag: "Left", left: { _tag: "NotFound" } });
    expect(result.denied.wrongGrant).toMatchObject({ _tag: "Left", left: { _tag: "NotFound" } });
    expect(result.denied.disabled).toMatchObject({ _tag: "Left", left: { _tag: "Forbidden" } });
    expect(result.deleted?.deletedAt).toMatch(/Z$/);
  });

  it("forbids reading item history", async () => {
    const program = Effect.gen(function* () {
      const { alpha } = yield* seedTagged();
      const share = makeKevaEngine(sharePrincipal("tenant-a", { scopes: ["read"] }));
      return yield* Effect.either(share.events(alpha.id));
    }).pipe(Effect.provide(layer()));

    const result = await Effect.runPromise(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("Forbidden");
  });

  it("forbids patch, delete, usage, and property autocomplete for shares", async () => {
    const program = Effect.gen(function* () {
      const { alpha } = yield* seedTagged();
      const p = sharePrincipal("tenant-a", { scopes: ["read", "write", "delete"] });
      const engine = makeKevaEngine(p);
      return {
        patch: yield* Effect.either(engine.patch(alpha.id, { set: { x: "one" }, unset: [] })),
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
