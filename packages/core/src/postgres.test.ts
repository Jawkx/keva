import type { Principal } from "@keva/schema";
import { Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine, reapPending } from "./engine.js";
import { MemoryBlobStoreLive } from "./memory.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { BlobStore, MetadataStore } from "./services.js";

/**
 * DB-gated acceptance for the Postgres metadata store. Requires a reachable
 * Postgres via KEVA_TEST_DATABASE_URL; when unset the whole suite is SKIPPED
 * (never failed) so the default suite passes with no database available.
 *
 *  - items + properties persist across a "restart" (a new store instance over
 *    the same database);
 *  - the query operator matrix (eq / neq / contains / range / exists) is
 *    correct and tenant-scoped;
 *  - opaque cursor pagination walks every row exactly once;
 *  - a concurrent confirm-vs-reaper race resolves to exactly one winner via the
 *    conditional, atomic `transition`.
 */

// Read the env without depending on @types/node (core has no node types):
// vitest still injects `process` at runtime.
const DATABASE_URL = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.KEVA_TEST_DATABASE_URL;

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle/0000_wandering_spiral.sql",
);

const applyMigration = async (sql: Sql): Promise<void> => {
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
};

describe.skipIf(!DATABASE_URL)("Postgres metadata store", () => {
  let sql: Sql;
  // Stand up the store + an in-memory blob store. The blob store is shared so
  // the test can pre-stage bytes that `confirm` will find via `head`/`copy`.
  const blobLayer = MemoryBlobStoreLive();

  const provide = (store: ReturnType<typeof makePostgresMetadataStore>) =>
    Layer.merge(Layer.succeed(MetadataStore, store), blobLayer);

  let layer: Layer.Layer<BlobStore | MetadataStore>;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 4 });
    await applyMigration(sql);
    layer = provide(makePostgresMetadataStore(sql));
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const run = <A, E>(effect: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  // initiate → stage bytes → confirm, returning the ready item's id
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
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(
        initiated.item.stagingKey,
        bytes,
        "text/plain",
        token,
      );
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  const createReadyWithType = (
    p: Principal,
    name: string,
    contentType: string,
    body: string,
  ) =>
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
      const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
      const blobs = yield* BlobStore;
      yield* blobs.devPut!(
        initiated.item.stagingKey,
        bytes,
        contentType,
        token,
      );
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  it("applies the checked-in migration indexes", async () => {
    const indexes = await sql<{
      indexname: string;
      indexdef: string;
    }[]>`
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
        yield* engine.patchProperties(created, {
          set: { project: "keva", rating: 9 },
          unset: [],
        });
        return created;
      }),
    );

    // "restart": a brand-new store instance over the same database
    const fresh = makePostgresMetadataStore(sql);
    const fetched = await Effect.runPromise(
      makeKevaEngine(p)
        .get(id)
        .pipe(
          Effect.provide(
            Layer.merge(Layer.succeed(MetadataStore, fresh), blobLayer),
          ),
        ),
    );
    expect(fetched.status).toBe("ready");
    expect(fetched.properties).toEqual({ project: "keva", rating: 9 });
  });

  it("serves the query operator matrix, tenant-scoped", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();

    const found = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(principal(tenantA));
        const a = yield* createReady(principal(tenantA), "a.txt", "a");
        yield* engine.patchProperties(a, {
          set: { kind: "doc", tags: ["x", "y"], rating: 5 },
          unset: [],
        });
        yield* createReady(principal(tenantB), "b.txt", "b"); // other tenant

        const eqHit = yield* engine.query({
          where: [{ key: "kind", op: "eq", value: "doc" }],
          limit: 100,
        });
        const neqHit = yield* engine.query({
          where: [{ key: "kind", op: "neq", value: "image" }],
          limit: 100,
        });
        const member = yield* engine.query({
          where: [{ key: "tags", op: "contains", value: "y" }],
          limit: 100,
        });
        const range = yield* engine.query({
          where: [{ key: "rating", op: "gte", value: 5 }],
          limit: 100,
        });
        const exists = yield* engine.query({
          where: [{ key: "kind", op: "exists" }],
          limit: 100,
        });
        // tenant B cannot see tenant A's items
        const crossTenant = yield* makeKevaEngine(principal(tenantB)).query({
          where: [{ key: "kind", op: "eq", value: "doc" }],
          limit: 100,
        });
        return { a, eqHit, neqHit, member, range, exists, crossTenant };
      }),
    );

    expect(found.eqHit.items.map((o) => o.id)).toEqual([found.a]);
    expect(found.neqHit.items.map((o) => o.id)).toEqual([found.a]);
    expect(found.member.items.map((o) => o.id)).toEqual([found.a]);
    expect(found.range.items.map((o) => o.id)).toEqual([found.a]);
    expect(found.exists.items.map((o) => o.id)).toEqual([found.a]);
    expect(found.crossTenant.items).toHaveLength(0);
  });

  it("paginates with an opaque cursor, covering every row exactly once", async () => {
    const tenant = crypto.randomUUID();
    const p = principal(tenant);

    const collected = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          ids.push(yield* createReady(p, `f${i}.txt`, `body-${i}`));
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const res = yield* engine.query({
            where: [],
            limit: 2,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          seen.push(...res.items.map((o) => o.id));
          if (res.nextCursor === undefined) break;
          cursor = res.nextCursor;
        }
        return { ids, seen };
      }),
    );

    expect(collected.seen.length).toBe(5);
    expect(new Set(collected.seen)).toEqual(new Set(collected.ids));
  });

  it("searches by name and content type with tenant-scoped pagination", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const found = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(principal(tenantA));
        const named = yield* createReady(
          principal(tenantA),
          "quarterly-fox.txt",
          "a",
        );
        const typed = yield* createReadyWithType(
          principal(tenantA),
          "diagram.svg",
          "image/fox-icon",
          "b",
        );
        yield* createReady(principal(tenantA), "plain.txt", "c");
        yield* createReady(principal(tenantB), "other-fox.txt", "d");
        const all = yield* engine.query({ where: [], search: "fox", limit: 100 });
        const first = yield* engine.query({ where: [], search: "fox", limit: 1 });
        const second = yield* engine.query({
          where: [],
          search: "fox",
          limit: 1,
          cursor: first.nextCursor,
        });
        const other = yield* makeKevaEngine(principal(tenantB)).query({
          where: [],
          search: "quarterly",
          limit: 100,
        });
        return { named, typed, all, first, second, other };
      }),
    );

    expect(found.all.items.map((item) => item.id).sort()).toEqual(
      [found.named, found.typed].sort(),
    );
    expect(found.first.items).toHaveLength(1);
    expect(found.second.items).toHaveLength(1);
    expect(new Set([
      found.first.items[0]!.id,
      found.second.items[0]!.id,
    ])).toEqual(new Set([found.named, found.typed]));
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
        // backdate the pending row so the reaper's cutoff includes it
        yield* Effect.promise(() =>
          sql`update items set created_at = now() - interval '1 hour'
              where id = ${initiated.item.id}`.then(() => undefined),
        );
        const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
        const blobs = yield* BlobStore;
        yield* blobs.devPut!(
          initiated.item.stagingKey,
          bytes,
          "text/plain",
          token,
        );

        // confirm and reaper contend for the same pending row
        const [confirmExit, reaped] = yield* Effect.all(
          [
            Effect.either(engine.confirm(initiated.item.id)),
            reapPending({ pendingTtlMs: 1 }),
          ],
          { concurrency: "unbounded" },
        );

        const metadata = yield* MetadataStore;
        const current = yield* metadata.get(tenant, initiated.item.id);
        return { confirmExit, reaped, status: current?.status ?? "gone" };
      }),
    );

    if (outcome.confirmExit._tag === "Right") {
      // confirm won: item is ready, reaper found nothing to reap
      expect(outcome.status).toBe("ready");
      expect(outcome.reaped).toBe(0);
    } else {
      // reaper won: confirm saw the row leave 'pending' → Conflict; row deleting
      expect(outcome.confirmExit.left._tag).toBe("Conflict");
      expect(outcome.status).toBe("deleting");
      expect(outcome.reaped).toBe(1);
    }
  });
});
