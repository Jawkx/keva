import type { ItemEvent, KevaItem, Query, QueryOrder } from "@keva/schema";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { testSql } from "./test/db.js";

// Validates the Postgres metadata store against the canonical query/usage/event
// semantics. Postgres is the only backend, so these run unconditionally against
// KEVA_TEST_DATABASE_URL.

const sql = testSql();
const store = makePostgresMetadataStore(sql);
afterAll(() => sql.end({ timeout: 5 }));

const SEED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ["alpha", "text/plain", { kind: "doc", tags: ["x", "y"], note: "hello world" }],
  ["bravo", "image/png", { kind: "image", tags: ["y", "z"] }],
  ["carol", "application/pdf", { kind: "doc", label: null }],
];

const QUERIES: Record<string, Query> = {
  eqString: {
    where: [{ key: "kind", op: "has_value", value: "doc" }],
    limit: 100,
    order: "created_at_asc",
  },
  neqString: {
    where: [{ key: "name", op: "neq", value: "bravo" }],
    limit: 100,
    order: "created_at_asc",
  },
  arrayMember: {
    where: [{ key: "tags", op: "has_value", value: "y" }],
    limit: 100,
    order: "created_at_asc",
  },
  substring: {
    where: [{ key: "note", op: "contains_text", value: "world" }],
    limit: 100,
    order: "created_at_asc",
  },
  rangeNumber: {
    where: [{ key: "system.size", op: "gte", value: 5 }],
    limit: 100,
    order: "created_at_asc",
  },
  existsKey: { where: [{ key: "label", op: "exists" }], limit: 100, order: "created_at_asc" },
  eqNull: { where: [{ key: "label", op: "is_tag" }], limit: 100, order: "created_at_asc" },
  neqPropTypeMismatch: {
    where: [{ key: "system.etag", op: "neq", value: "etag" }],
    limit: 100,
    order: "created_at_asc",
  },
  sysContentTypeEq: {
    where: [{ key: "system.content_type", op: "eq", value: "image/png" }],
    limit: 100,
    order: "created_at_asc",
  },
  inSysContentType: {
    where: [
      { key: "system.content_type", op: "contains_any", value: ["application/pdf", "text/"] },
    ],
    limit: 100,
    order: "created_at_asc",
  },
  inPropString: {
    where: [{ key: "kind", op: "has_any", value: ["image", "doc"] }],
    limit: 100,
    order: "created_at_asc",
  },
  inArrayProp: {
    where: [{ key: "tags", op: "has_any", value: ["z", "q"] }],
    limit: 100,
    order: "created_at_asc",
  },
};

const EXPECTED: Record<string, string[]> = {
  eqString: ["alpha", "carol"],
  neqString: ["alpha", "carol"],
  arrayMember: ["alpha", "bravo"],
  substring: ["alpha"],
  rangeNumber: ["alpha", "bravo", "carol"],
  existsKey: ["carol"],
  eqNull: ["carol"],
  neqPropTypeMismatch: ["alpha", "bravo", "carol"],
  sysContentTypeEq: ["bravo"],
  inSysContentType: ["alpha", "carol"],
  inPropString: ["alpha", "bravo", "carol"],
  inArrayProp: ["bravo"],
};

const readyItem = (
  tenantId: string,
  id: string,
  name: string,
  createdAt: string,
  overrides: Partial<KevaItem> = {},
): KevaItem => ({
  id,
  tenantId,
  name,
  contentType: "text/plain",
  declaredSize: name.length,
  size: name.length,
  etag: null,
  checksum: null,
  source: "upload",
  status: "ready",
  storageKey: `items/${tenantId}/${id}`,
  stagingKey: `staging/${tenantId}/${id}`,
  createdAt,
  updatedAt: createdAt,
  properties: {},
  ...overrides,
});

const seed = async (): Promise<string> => {
  const tenant = crypto.randomUUID();
  const timestamp = "2026-01-01T00:00:00.000Z";
  for (const [name, contentType, properties] of SEED) {
    await Effect.runPromise(
      store.insert(
        readyItem(tenant, crypto.randomUUID(), name, timestamp, {
          contentType,
          properties: properties as KevaItem["properties"],
        }),
      ),
    );
  }
  return tenant;
};

const seedAndRun = async (): Promise<Record<string, string[]>> => {
  const tenant = await seed();
  const results: Record<string, string[]> = {};
  for (const [label, query] of Object.entries(QUERIES)) {
    const res = await Effect.runPromise(store.query(tenant, query));
    results[label] = res.items.map((item) => item.name).sort();
  }
  return results;
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

const seedAndSourceUsage = async () => {
  const tenant = crypto.randomUUID();
  const other = crypto.randomUUID();
  const row = (
    tenantId: string,
    source: string,
    status: KevaItem["status"],
    declaredSize: number,
    size: number | null,
  ): KevaItem =>
    readyItem(tenantId, crypto.randomUUID(), "x", "2026-01-01T00:00:00.000Z", {
      source,
      status,
      declaredSize,
      size,
    });
  const rows: KevaItem[] = [
    row(tenant, "share:g1", "ready", 100, 100),
    row(tenant, "share:g1", "pending", 200, null),
    row(tenant, "share:g1", "deleting", 400, 400),
    row(tenant, "share:g2", "ready", 800, 800),
    row(other, "share:g1", "ready", 1600, 1600),
  ];
  for (const item of rows) await Effect.runPromise(store.insert(item));
  return Effect.runPromise(store.sourceUsage(tenant, "share:g1"));
};

const EXPECTED_SOURCE_USAGE = { count: 2, bytes: 300 };

const patchAtPropertyLimit = async () => {
  const tenant = crypto.randomUUID();
  const id = crypto.randomUUID();
  const timestamp = "2026-01-01T00:00:00.000Z";
  await Effect.runPromise(store.insert(readyItem(tenant, id, "limit.txt", timestamp)));
  const properties = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [`key-${index}`, String(index)]),
  );
  await Effect.runPromise(
    store.patch(tenant, id, { fields: {}, set: properties, unset: [] }, timestamp),
  );
  const rejected = await Effect.runPromise(
    Effect.either(
      store.patch(tenant, id, { fields: {}, set: { overflow: "yes" }, unset: [] }, timestamp),
    ),
  );
  const item = await Effect.runPromise(store.get(tenant, id));
  return {
    rejected: rejected._tag === "Left" ? rejected.left._tag : null,
    properties: item?.properties,
  };
};

const seedAndListEvents = async () => {
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
      set: { rating: "five" },
      previous: { rating: "one" },
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

const collectPaginatedOrder = async (order: QueryOrder) => {
  const tenant = crypto.randomUUID();
  const rows = [
    readyItem(tenant, crypto.randomUUID(), "alpha", "2026-01-01T00:00:00.000Z"),
    readyItem(tenant, crypto.randomUUID(), "bravo", "2026-01-01T00:02:00.000Z"),
    readyItem(tenant, crypto.randomUUID(), "carol", "2026-01-01T00:01:00.000Z"),
  ];
  for (const row of rows) await Effect.runPromise(store.insert(row));

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

const collectPaginatedSizeOrder = async (order: "size_asc" | "size_desc") => {
  const tenant = crypto.randomUUID();
  const createdAt = "2026-01-01T00:00:00.000Z";
  const idPrefix = order === "size_asc" ? "00000000" : "10000000";
  const rows = [
    readyItem(tenant, `${idPrefix}-0000-0000-0000-000000000001`, "alpha", createdAt, {
      declaredSize: 10,
      size: 10,
    }),
    readyItem(tenant, `${idPrefix}-0000-0000-0000-000000000002`, "bravo", createdAt, {
      declaredSize: 2,
      size: 2,
    }),
    readyItem(tenant, `${idPrefix}-0000-0000-0000-000000000003`, "carol", createdAt, {
      declaredSize: 10,
      size: 10,
    }),
    readyItem(tenant, `${idPrefix}-0000-0000-0000-000000000004`, "delta", createdAt, {
      declaredSize: 5,
      size: null,
    }),
  ];
  for (const row of rows) await Effect.runPromise(store.insert(row));

  const names: string[] = [];
  const pageCursors: boolean[] = [];
  let cursor: string | undefined;
  do {
    const page = await Effect.runPromise(
      store.query(tenant, { where: [], limit: 2, order, cursor }),
    );
    names.push(...page.items.map((item) => item.name));
    pageCursors.push(Boolean(page.nextCursor));
    cursor = page.nextCursor;
  } while (cursor);
  return { names, pageCursors };
};

describe("postgres store semantics", () => {
  it("serves the specified query operator matrix", async () => {
    expect(await seedAndRun()).toEqual(EXPECTED);
  });

  it("reports usage totals and a per-type breakdown", async () => {
    const tenant = await seed();
    expect(await Effect.runPromise(store.usage(tenant))).toEqual(EXPECTED_USAGE);
  });

  it("sums source usage over pending+ready of one tenant/source", async () => {
    expect(await seedAndSourceUsage()).toEqual(EXPECTED_SOURCE_USAGE);
  });

  it("rejects a committed patch over the canonical property limit", async () => {
    await expect(patchAtPropertyLimit()).resolves.toMatchObject({
      rejected: "QuotaExceeded",
      properties: Object.fromEntries(
        Array.from({ length: 256 }, (_, index) => [`key-${index}`, String(index)]),
      ),
    });
  });

  it("lists item events newest-first with keyset pagination", async () => {
    const { events, pageCursors } = await seedAndListEvents();
    expect(events.map((event) => event.id.slice(-2))).toEqual(["34", "33", "32", "31"]);
    expect(pageCursors).toEqual([true, false]);
    expect(events[1]!.payload).toEqual({ set: { rating: "five" }, previous: { rating: "one" } });
    expect(events[3]!.actor).toEqual({ token: { id: "tok-1", name: "CI token" } });
  });

  it("paginates explicit created-time orders", async () => {
    await expect(collectPaginatedOrder("created_at_asc")).resolves.toEqual({
      names: ["alpha", "carol", "bravo"],
      pageCursors: [true, true, false],
    });
    await expect(collectPaginatedOrder("created_at_desc")).resolves.toEqual({
      names: ["bravo", "carol", "alpha"],
      pageCursors: [true, true, false],
    });
  });

  it("paginates size orders with stable ties and declared-size fallback", async () => {
    await expect(collectPaginatedSizeOrder("size_asc")).resolves.toEqual({
      names: ["bravo", "delta", "alpha", "carol"],
      pageCursors: [true, false],
    });
    await expect(collectPaginatedSizeOrder("size_desc")).resolves.toEqual({
      names: ["carol", "alpha", "delta", "bravo"],
      pageCursors: [true, false],
    });
  });

  it("rejects a cursor when the query order changes", async () => {
    const tenant = await seed();
    const firstPage = await Effect.runPromise(
      store.query(tenant, { where: [], limit: 1, order: "size_asc" }),
    );

    const result = await Effect.runPromise(
      Effect.either(
        store.query(tenant, {
          where: [],
          limit: 1,
          order: "size_desc",
          cursor: firstPage.nextCursor,
        }),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: { _tag: "ValidationError" } });
  });
});
