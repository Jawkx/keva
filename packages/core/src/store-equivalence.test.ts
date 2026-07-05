import type { KevaItem, Principal, Query, QueryOrder } from "@keva/schema";
import { Effect, Layer } from "effect";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine } from "./engine.js";
import { makeMemoryMetadataStore, MemoryBlobStoreLive } from "./memory.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { BlobStore, MetadataStore, type MetadataStoreService } from "./services.js";

const DATABASE_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.KEVA_TEST_DATABASE_URL;

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

const SEED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ["alpha", "text/plain", { kind: "doc", rating: 5, tags: ["x", "y"], note: "hello world" }],
  ["bravo", "image/png", { kind: "image", rating: 10, tags: ["y", "z"] }],
  ["carol", "application/pdf", { kind: "doc", rating: 1, label: null }],
];

const QUERIES: Record<string, Query> = {
  eqString: {
    where: [{ key: "kind", op: "eq", value: "doc" }],
    limit: 100,
    order: "created_at_asc",
  },
  neqString: {
    where: [{ key: "kind", op: "neq", value: "image" }],
    limit: 100,
    order: "created_at_asc",
  },
  arrayMember: {
    where: [{ key: "tags", op: "contains", value: "y" }],
    limit: 100,
    order: "created_at_asc",
  },
  substring: {
    where: [{ key: "note", op: "contains", value: "world" }],
    limit: 100,
    order: "created_at_asc",
  },
  rangeNumber: {
    where: [{ key: "rating", op: "gte", value: 5 }],
    limit: 100,
    order: "created_at_asc",
  },
  existsKey: { where: [{ key: "label", op: "exists" }], limit: 100, order: "created_at_asc" },
  eqNull: { where: [{ key: "label", op: "eq", value: null }], limit: 100, order: "created_at_asc" },
  neqPropTypeMismatch: {
    where: [{ key: "rating", op: "neq", value: "5" }],
    limit: 100,
    order: "created_at_asc",
  },
  sysContentTypeEq: {
    where: [{ key: "system.content_type", op: "eq", value: "image/png" }],
    limit: 100,
    order: "created_at_asc",
  },
  sysContentTypeNeq: {
    where: [{ key: "system.content_type", op: "neq", value: "image/png" }],
    limit: 100,
    order: "created_at_asc",
  },
  sysSizeNeqTypeMismatch: {
    where: [{ key: "system.size", op: "neq", value: "x" }],
    limit: 100,
    order: "created_at_asc",
  },
};

const EXPECTED: Record<string, string[]> = {
  eqString: ["alpha", "carol"],
  neqString: ["alpha", "carol"],
  arrayMember: ["alpha", "bravo"],
  substring: ["alpha"],
  rangeNumber: ["alpha", "bravo"],
  existsKey: ["carol"],
  eqNull: ["carol"],
  neqPropTypeMismatch: ["alpha", "bravo", "carol"],
  sysContentTypeEq: ["bravo"],
  sysContentTypeNeq: ["alpha", "carol"],
  sysSizeNeqTypeMismatch: ["alpha", "bravo", "carol"],
};

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

const applyMigrations = async (sql: Sql): Promise<void> => {
  const files = (await readdir(migrationDir)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();

  for (const file of files) {
    const migration = await readFile(resolve(migrationDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
  }
};

const orderedItem = (tenantId: string, id: string, name: string, createdAt: string): KevaItem => ({
  id,
  tenantId,
  name,
  contentType: "text/plain",
  declaredSize: 1,
  size: 1,
  etag: null,
  checksum: null,
  source: "upload",
  status: "ready",
  storageKey: `items/${tenantId}/${id}`,
  stagingKey: `staging/${tenantId}/${id}`,
  createdAt,
  updatedAt: createdAt,
  properties: {},
});

const collectPaginatedOrder = async (
  store: MetadataStoreService,
  order: QueryOrder,
): Promise<{ names: string[]; pageCursors: boolean[] }> => {
  const tenant = crypto.randomUUID();
  const rows = [
    orderedItem(
      tenant,
      "00000000-0000-4000-8000-000000000001",
      "alpha",
      "2026-01-01T00:00:00.000Z",
    ),
    orderedItem(
      tenant,
      "00000000-0000-4000-8000-000000000002",
      "bravo",
      "2026-01-01T00:02:00.000Z",
    ),
    orderedItem(
      tenant,
      "00000000-0000-4000-8000-000000000003",
      "carol",
      "2026-01-01T00:01:00.000Z",
    ),
  ];

  for (const row of rows) {
    await Effect.runPromise(store.insert(row));
  }

  const names: string[] = [];
  const pageCursors: boolean[] = [];
  let cursor: string | undefined;
  do {
    const page = await Effect.runPromise(
      store.query(tenant, { where: [], limit: 1, order, cursor }),
    );
    names.push(...page.items.map((item) => item.name));
    pageCursors.push(Boolean(page.nextCursor));
    cursor = page.nextCursor;
  } while (cursor);

  return { names, pageCursors };
};

const seedStore = async (store: MetadataStoreService) => {
  const tenant = crypto.randomUUID();
  const p = principal(tenant);
  const layer = Layer.merge(Layer.succeed(MetadataStore, store), MemoryBlobStoreLive());
  const run = <A, E>(effect: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  for (const [name, contentType, properties] of SEED) {
    await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const bytes = new TextEncoder().encode(name);
        const initiated = yield* engine.initiate({
          name,
          contentType,
          size: bytes.byteLength,
          source: "upload",
          properties: {},
        });
        const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
        const blobs = yield* BlobStore;
        yield* blobs.devPut!(initiated.item.stagingKey, bytes, contentType, token);
        yield* engine.confirm(initiated.item.id);
        yield* engine.patch(initiated.item.id, {
          set: properties as Record<string, never>,
          unset: [],
        });
      }),
    );
  }

  return { p, run };
};

const seedAndRun = async (store: MetadataStoreService): Promise<Record<string, string[]>> => {
  const { p, run } = await seedStore(store);
  const results: Record<string, string[]> = {};
  for (const [label, query] of Object.entries(QUERIES)) {
    const res = await run(makeKevaEngine(p).query(query));
    results[label] = res.items.map((item) => item.name).sort();
  }
  return results;
};

const seedAndUsage = async (store: MetadataStoreService) => {
  const { p, run } = await seedStore(store);
  return run(makeKevaEngine(p).usage());
};

// Every seed name is 5 bytes; each content type appears once. Ordering is
// bytes desc then contentType asc, so equal-sized types sort alphabetically.
const EXPECTED_USAGE = {
  itemCount: 3,
  totalBytes: 15,
  byType: [
    { contentType: "application/pdf", count: 1, bytes: 5 },
    { contentType: "image/png", count: 1, bytes: 5 },
    { contentType: "text/plain", count: 1, bytes: 5 },
  ],
};

describe("store query equivalence", () => {
  it("the in-memory store matches the specified semantics", async () => {
    const got = await seedAndRun(makeMemoryMetadataStore());
    expect(got).toEqual(EXPECTED);
  });

  it("the in-memory store reports usage totals and a per-type breakdown", async () => {
    const usage = await seedAndUsage(makeMemoryMetadataStore());
    expect(usage).toEqual(EXPECTED_USAGE);
  });

  it("the in-memory store paginates explicit created-time orders", async () => {
    await expect(
      collectPaginatedOrder(makeMemoryMetadataStore(), "created_at_asc"),
    ).resolves.toEqual({
      names: ["alpha", "carol", "bravo"],
      pageCursors: [true, true, false],
    });
    await expect(
      collectPaginatedOrder(makeMemoryMetadataStore(), "created_at_desc"),
    ).resolves.toEqual({
      names: ["bravo", "carol", "alpha"],
      pageCursors: [true, true, false],
    });
  });

  describe.skipIf(!DATABASE_URL)("postgres equals memory", () => {
    let sql: Sql;

    beforeAll(async () => {
      sql = postgres(DATABASE_URL!, { max: 4 });
      await applyMigrations(sql);
    });

    afterAll(async () => {
      await sql.end({ timeout: 5 });
    });

    it("returns identical results for every query in the battery", async () => {
      const memory = await seedAndRun(makeMemoryMetadataStore());
      const pg = await seedAndRun(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg).toEqual(EXPECTED);
    });

    it("returns identical usage totals and breakdown to memory", async () => {
      const memory = await seedAndUsage(makeMemoryMetadataStore());
      const pg = await seedAndUsage(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg).toEqual(EXPECTED_USAGE);
    });

    it("matches memory pagination for explicit created-time orders", async () => {
      for (const order of ["created_at_asc", "created_at_desc"] as const) {
        const memory = await collectPaginatedOrder(makeMemoryMetadataStore(), order);
        const pg = await collectPaginatedOrder(makePostgresMetadataStore(sql), order);
        expect(pg).toEqual(memory);
      }
    });
  });
});
