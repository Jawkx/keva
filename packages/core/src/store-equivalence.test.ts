import type { ItemEvent, KevaItem, Principal, Query, QueryOrder } from "@keva/schema";
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
  inSysContentType: {
    where: [{ key: "system.content_type", op: "in", value: ["application/pdf", "text/"] }],
    limit: 100,
    order: "created_at_asc",
  },
  inPropString: {
    where: [{ key: "kind", op: "in", value: ["image", "doc"] }],
    limit: 100,
    order: "created_at_asc",
  },
  inArrayProp: {
    where: [{ key: "tags", op: "in", value: ["z", "q"] }],
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
  inSysContentType: ["alpha", "carol"],
  inPropString: ["alpha", "bravo", "carol"],
  inArrayProp: ["bravo"],
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
  // Fresh ids per invocation: item.id is a global primary key in Postgres, so
  // reusing fixed ids across tenants would collide. Ordering is by createdAt
  // (all distinct here), so the id values do not affect the expected result.
  const rows = [
    orderedItem(tenant, crypto.randomUUID(), "alpha", "2026-01-01T00:00:00.000Z"),
    orderedItem(tenant, crypto.randomUUID(), "bravo", "2026-01-01T00:02:00.000Z"),
    orderedItem(tenant, crypto.randomUUID(), "carol", "2026-01-01T00:01:00.000Z"),
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

const EXPECTED_USAGE = {
  itemCount: 3,
  totalBytes: 15,
  quotaBytes: 10_737_418_240,
  remainingBytes: 10_737_418_225,
  byType: [
    { contentType: "application/pdf", count: 1, bytes: 5 },
    { contentType: "image/png", count: 1, bytes: 5 },
    { contentType: "text/plain", count: 1, bytes: 5 },
  ],
};

const seedAndSourceUsage = async (store: MetadataStoreService) => {
  const tenant = crypto.randomUUID();
  const other = crypto.randomUUID();
  const row = (
    idSuffix: string,
    tenantId: string,
    source: string,
    status: KevaItem["status"],
    declaredSize: number,
    size: number | null,
  ): KevaItem => ({
    ...orderedItem(
      tenantId,
      `00000000-0000-4000-8000-0000000000${idSuffix}`,
      idSuffix,
      "2026-01-01T00:00:00.000Z",
    ),
    source,
    status,
    declaredSize,
    size,
  });
  const rows: KevaItem[] = [
    row("11", tenant, "share:g1", "ready", 100, 100),
    row("12", tenant, "share:g1", "pending", 200, null),
    row("13", tenant, "share:g1", "deleting", 400, 400),
    row("14", tenant, "share:g2", "ready", 800, 800),
    row("15", other, "share:g1", "ready", 1600, 1600),
  ];
  for (const item of rows) await Effect.runPromise(store.insert(item));
  return Effect.runPromise(store.sourceUsage(tenant, "share:g1"));
};

const EXPECTED_SOURCE_USAGE = { count: 2, bytes: 300 };

const patchAtPropertyLimit = async (store: MetadataStoreService) => {
  const tenant = crypto.randomUUID();
  const id = crypto.randomUUID();
  const timestamp = "2026-01-01T00:00:00.000Z";
  await Effect.runPromise(store.insert(orderedItem(tenant, id, "limit.txt", timestamp)));
  const properties = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [`key-${index}`, index]),
  );
  await Effect.runPromise(
    store.patch(tenant, id, { fields: {}, set: properties, unset: [] }, timestamp),
  );
  const rejected = await Effect.runPromise(
    Effect.either(
      store.patch(tenant, id, { fields: {}, set: { overflow: true }, unset: [] }, timestamp),
    ),
  );
  const item = await Effect.runPromise(store.get(tenant, id));
  return {
    rejected: rejected._tag === "Left" ? rejected.left._tag : null,
    properties: item?.properties,
  };
};

const seedAndListEvents = async (store: MetadataStoreService) => {
  const tenant = crypto.randomUUID();
  const other = crypto.randomUUID();
  const itemId = "00000000-0000-4000-8000-000000000021";
  const event = (
    idSuffix: string,
    tenantId: string,
    targetItemId: string,
    action: ItemEvent["action"],
    createdAt: string,
    payload: ItemEvent["payload"] = {},
  ): ItemEvent => ({
    id: `00000000-0000-4000-8000-0000000000${idSuffix}`,
    tenantId,
    itemId: targetItemId,
    itemName: "history.txt",
    action,
    actor: { token: { id: "tok-1", name: "CI token" } },
    payload,
    createdAt,
  });
  const rows: ItemEvent[] = [
    event("31", tenant, itemId, "uploaded", "2026-01-01T00:00:00.000Z", {
      size: 1,
      contentType: "text/plain",
      source: "upload",
    }),
    event("32", tenant, itemId, "renamed", "2026-01-01T00:01:00.000Z", {
      from: "a.txt",
      to: "b.txt",
    }),
    event("33", tenant, itemId, "properties_changed", "2026-01-01T00:02:00.000Z", {
      set: { rating: 5 },
      previous: { rating: 1 },
    }),
    event("34", tenant, itemId, "deleted", "2026-01-01T00:02:00.000Z"),
    event(
      "35",
      tenant,
      "00000000-0000-4000-8000-000000000022",
      "uploaded",
      "2026-01-01T00:03:00.000Z",
    ),
    event("36", other, itemId, "uploaded", "2026-01-01T00:03:00.000Z"),
  ];
  for (const row of rows) await Effect.runPromise(store.appendEvent(row));

  const pages: ItemEvent[][] = [];
  const pageCursors: boolean[] = [];
  let cursor: string | undefined;
  do {
    const page = await Effect.runPromise(
      store.listEvents(tenant, itemId, { limit: 2, ...(cursor ? { cursor } : {}) }),
    );
    pages.push([...page.events]);
    pageCursors.push(Boolean(page.nextCursor));
    cursor = page.nextCursor;
  } while (cursor);

  return { events: pages.flat(), pageCursors };
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

  it("the in-memory store sums source usage over pending+ready of one tenant/source", async () => {
    const usage = await seedAndSourceUsage(makeMemoryMetadataStore());
    expect(usage).toEqual(EXPECTED_SOURCE_USAGE);
  });

  it("the in-memory store rejects a committed patch over the canonical property limit", async () => {
    await expect(patchAtPropertyLimit(makeMemoryMetadataStore())).resolves.toMatchObject({
      rejected: "QuotaExceeded",
      properties: Object.fromEntries(
        Array.from({ length: 256 }, (_, index) => [`key-${index}`, index]),
      ),
    });
  });

  it("the in-memory store lists item events newest-first with keyset pagination", async () => {
    const { events, pageCursors } = await seedAndListEvents(makeMemoryMetadataStore());
    expect(events.map((event) => event.id.slice(-2))).toEqual(["34", "33", "32", "31"]);
    expect(pageCursors).toEqual([true, false]);
    expect(events[1]!.payload).toEqual({ set: { rating: 5 }, previous: { rating: 1 } });
    expect(events[3]!.actor).toEqual({ token: { id: "tok-1", name: "CI token" } });
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

    it("returns identical source usage to memory", async () => {
      const memory = await seedAndSourceUsage(makeMemoryMetadataStore());
      const pg = await seedAndSourceUsage(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg).toEqual(EXPECTED_SOURCE_USAGE);
    });

    it("matches memory when a patch exceeds the canonical property limit", async () => {
      const memory = await patchAtPropertyLimit(makeMemoryMetadataStore());
      const pg = await patchAtPropertyLimit(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg.rejected).toBe("QuotaExceeded");
      expect(Object.keys(pg.properties ?? {})).toHaveLength(256);
    });

    it("matches memory pagination for explicit created-time orders", async () => {
      for (const order of ["created_at_asc", "created_at_desc"] as const) {
        const memory = await collectPaginatedOrder(makeMemoryMetadataStore(), order);
        const pg = await collectPaginatedOrder(makePostgresMetadataStore(sql), order);
        expect(pg).toEqual(memory);
      }
    });

    it("matches memory for item event listing and pagination", async () => {
      const memory = await seedAndListEvents(makeMemoryMetadataStore());
      const pg = await seedAndListEvents(makePostgresMetadataStore(sql));
      const normalize = (result: typeof memory) => ({
        pageCursors: result.pageCursors,
        events: result.events.map(({ tenantId: _tenantId, ...event }) => event),
      });
      expect(normalize(pg)).toEqual(normalize(memory));
    });
  });
});
