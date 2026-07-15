import type { Principal } from "@keva/schema";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine, reapPending } from "./engine.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { S3BlobStoreLive } from "./s3.js";
import { BlobStore, MetadataStore } from "./services.js";
import { testSql } from "./test/db.js";
import { putObject, s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

describe("Postgres metadata store", () => {
  const sql = testSql(4);
  let mock: S3Mock;
  let layer: Layer.Layer<BlobStore | MetadataStore>;

  beforeAll(async () => {
    mock = await startS3Mock();
    layer = Layer.merge(
      Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
      S3BlobStoreLive(s3MockConfig(mock)),
    );
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await mock.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  const stage = (key: string, bytes: Uint8Array, contentType: string) =>
    Effect.promise(() => putObject(mock, key, bytes, contentType));

  const createReady = (p: Principal, name: string, body: string) =>
    Effect.gen(function* () {
      const engine = makeKevaEngine(p);
      const bytes = new TextEncoder().encode(body);
      const initiated = yield* engine.initiate({
        name,
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      yield* stage(initiated.item.stagingKey, bytes, "text/plain");
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  const createReadyWithType = (p: Principal, name: string, contentType: string, body: string) =>
    Effect.gen(function* () {
      const engine = makeKevaEngine(p);
      const bytes = new TextEncoder().encode(body);
      const initiated = yield* engine.initiate({
        name,
        contentType,
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      yield* stage(initiated.item.stagingKey, bytes, contentType);
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  it("applies the checked-in migration indexes", async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = current_schema()
        and indexname in (
          'items_properties_gin_idx',
          'items_tenant_status_created_idx',
          'items_tenant_created_id_idx',
          'api_tokens_tenant_created_idx'
        )
    `;
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(byName.get("items_properties_gin_idx")).toContain("USING gin");
    expect(byName.has("items_tenant_status_created_idx")).toBe(true);
    expect(byName.has("items_tenant_created_id_idx")).toBe(true);
    expect(byName.has("api_tokens_tenant_created_idx")).toBe(true);
  });

  it("persists items + properties across a new store instance", async () => {
    const tenant = crypto.randomUUID();
    const p = principal(tenant);

    const id = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const created = yield* createReady(p, "persist.txt", "durable bytes");
        yield* engine.patch(created, { set: { project: "keva", rating: "nine" }, unset: [] });
        return created;
      }),
    );

    const fresh = makePostgresMetadataStore(sql);
    const fetched = await Effect.runPromise(
      makeKevaEngine(p)
        .get(id)
        .pipe(
          Effect.provide(
            Layer.merge(Layer.succeed(MetadataStore, fresh), S3BlobStoreLive(s3MockConfig(mock))),
          ),
        ),
    );
    expect(fetched.status).toBe("ready");
    expect(fetched.properties).toEqual({ project: "keva", rating: "nine" });
  });

  it("searches by name and content type with tenant-scoped pagination", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const found = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(principal(tenantA));
        const named = yield* createReady(principal(tenantA), "quarterly-fox.txt", "a");
        const typed = yield* createReadyWithType(
          principal(tenantA),
          "diagram.svg",
          "image/fox-icon",
          "b",
        );
        yield* createReady(principal(tenantA), "plain.txt", "c");
        yield* createReady(principal(tenantB), "other-fox.txt", "d");
        const all = yield* engine.query({
          where: [],
          search: "fox",
          limit: 100,
          order: "created_at_asc",
        });
        const first = yield* engine.query({
          where: [],
          search: "fox",
          limit: 1,
          order: "created_at_asc",
        });
        const second = yield* engine.query({
          where: [],
          search: "fox",
          limit: 1,
          order: "created_at_asc",
          cursor: first.nextCursor,
        });
        const other = yield* makeKevaEngine(principal(tenantB)).query({
          where: [],
          search: "quarterly",
          limit: 100,
          order: "created_at_asc",
        });
        return { named, typed, all, first, second, other };
      }),
    );

    expect(found.all.items.map((item) => item.id).sort()).toEqual(
      [found.named, found.typed].sort(),
    );
    expect(found.first.items).toHaveLength(1);
    expect(found.second.items).toHaveLength(1);
    expect(new Set([found.first.items[0]!.id, found.second.items[0]!.id])).toEqual(
      new Set([found.named, found.typed]),
    );
    expect(found.other.items).toHaveLength(0);
  });

  it("resolves a concurrent confirm-vs-reaper race to exactly one winner", async () => {
    const tenant = crypto.randomUUID();
    const p = principal(tenant);

    const outcome = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const bytes = new TextEncoder().encode("racing");
        const initiated = yield* engine.initiate({
          name: "race.txt",
          contentType: "text/plain",
          size: bytes.byteLength,
          source: "upload",
          properties: {},
        });
        yield* Effect.promise(() =>
          sql`update items set created_at = now() - interval '1 hour'
              where id = ${initiated.item.id}`.then(() => undefined),
        );
        yield* stage(initiated.item.stagingKey, bytes, "text/plain");

        const [confirmExit, reaped] = yield* Effect.all(
          [Effect.either(engine.confirm(initiated.item.id)), reapPending({ pendingTtlMs: 1 })],
          { concurrency: "unbounded" },
        );

        const metadata = yield* MetadataStore;
        const current = yield* metadata.get(tenant, initiated.item.id);
        return { confirmExit, reaped, status: current?.status ?? "gone" };
      }),
    );

    if (outcome.confirmExit._tag === "Right") {
      expect(outcome.status).toBe("ready");
      expect(outcome.reaped).toBe(0);
    } else {
      expect(outcome.confirmExit.left._tag).toBe("Conflict");
      expect(outcome.status).toBe("deleting");
      expect(outcome.reaped).toBe(1);
    }
  });
});
