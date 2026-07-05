import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BatchDelete,
  CreateShareGrant,
  ItemId,
  itemMatchesCondition,
  type KevaItem,
  Principal,
  Properties,
  propertiesMatchCondition,
  Query,
  toSharedItem,
  UsageResult,
} from "./index.js";

describe("schema", () => {
  it("rejects mixed arrays and reserved keys", () => {
    expect(() => Schema.decodeUnknownSync(Properties)({ tags: ["a", 1] })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ "system.owner": "me" })).toThrow();
  });

  it("applies query defaults and rejects invalid operator values", () => {
    expect(Schema.decodeUnknownSync(Query)({})).toEqual({
      where: [],
      limit: 100,
      order: "created_at_asc",
    });
    expect(() =>
      Schema.decodeUnknownSync(Query)({
        where: [{ key: "rating", op: "gt", value: true }],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Query)({
        where: [{ key: "system.unknown", op: "exists" }],
      }),
    ).toThrow();
  });

  it("validates optional query search", () => {
    expect(Schema.decodeUnknownSync(Query)({ search: "fox" })).toEqual({
      where: [],
      search: "fox",
      limit: 100,
      order: "created_at_asc",
    });
    expect(() => Schema.decodeUnknownSync(Query)({ search: "x".repeat(257) })).toThrow();
  });

  it("validates explicit query ordering", () => {
    expect(Schema.decodeUnknownSync(Query)({ order: "created_at_desc" })).toMatchObject({
      order: "created_at_desc",
    });
    expect(() => Schema.decodeUnknownSync(Query)({ order: "name_desc" })).toThrow();
  });

  it("validates item ids at API boundaries", () => {
    expect(Schema.decodeUnknownSync(ItemId)("00000000-0000-0000-0000-000000000000")).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(() => Schema.decodeUnknownSync(ItemId)("not-a-uuid")).toThrow();
    expect(() => Schema.decodeUnknownSync(BatchDelete)({ ids: ["not-a-uuid"] })).toThrow();
  });

  it("round-trips a usage result", () => {
    const usage = {
      itemCount: 3,
      totalBytes: 4096,
      byType: [
        { contentType: "image/png", count: 2, bytes: 3072 },
        { contentType: "text/plain", count: 1, bytes: 1024 },
      ],
    };
    expect(Schema.decodeUnknownSync(UsageResult)(usage)).toEqual(usage);
    expect(() => Schema.decodeUnknownSync(UsageResult)({ itemCount: 0, totalBytes: 0 })).toThrow();
  });
});

const sampleItem = (overrides: Partial<KevaItem> = {}): KevaItem => ({
  id: "00000000-0000-0000-0000-000000000001",
  tenantId: "tenant-a",
  name: "report.pdf",
  contentType: "application/pdf",
  declaredSize: 2048,
  size: 2048,
  etag: "etag",
  checksum: null,
  source: "upload",
  status: "ready",
  storageKey: "items/tenant-a/1",
  stagingKey: "staging/tenant-a/1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  properties: { project: "alpha", tags: ["x", "y"], rating: 5 },
  ...overrides,
});

describe("condition evaluator", () => {
  it("evaluates property conditions across operators", () => {
    const item = sampleItem();
    expect(itemMatchesCondition(item, { key: "project", op: "eq", value: "alpha" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "project", op: "eq", value: "beta" })).toBe(false);
    expect(itemMatchesCondition(item, { key: "project", op: "exists" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "missing", op: "exists" })).toBe(false);
    expect(itemMatchesCondition(item, { key: "missing", op: "eq", value: "x" })).toBe(false);
    expect(itemMatchesCondition(item, { key: "rating", op: "gt", value: 3 })).toBe(true);
    expect(itemMatchesCondition(item, { key: "rating", op: "lt", value: 3 })).toBe(false);
    expect(itemMatchesCondition(item, { key: "tags", op: "contains", value: "x" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "tags", op: "contains", value: "z" })).toBe(false);
    expect(itemMatchesCondition(item, { key: "project", op: "neq", value: "beta" })).toBe(true);
  });

  it("resolves declared system fields for items", () => {
    const item = sampleItem();
    expect(itemMatchesCondition(item, { key: "name", op: "eq", value: "report.pdf" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "system.size", op: "gte", value: 2048 })).toBe(true);
    expect(itemMatchesCondition(item, { key: "system.size", op: "gt", value: 4096 })).toBe(false);
  });

  it("evaluates property-blob conditions without an item", () => {
    const stamp = { project: "alpha" };
    expect(propertiesMatchCondition(stamp, { key: "project", op: "eq", value: "alpha" })).toBe(true);
    expect(propertiesMatchCondition(stamp, { key: "project", op: "exists" })).toBe(true);
    expect(propertiesMatchCondition(stamp, { key: "other", op: "exists" })).toBe(false);
  });
});

describe("CreateShareGrant", () => {
  const base = {
    name: "Client drop",
    conditions: [{ key: "project", op: "eq", value: "alpha" }],
  };

  it("accepts a read-only grant with system-field conditions", () => {
    const grant = Schema.decodeUnknownSync(CreateShareGrant)({
      ...base,
      scopes: ["read"],
      conditions: [{ key: "system.size", op: "gt", value: 0 }],
    });
    expect(grant.scopes).toEqual(["read"]);
  });

  it("requires a writeStamp for write grants", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({ ...base, scopes: ["write"] }),
    ).toThrow();
  });

  it("rejects write grants conditioning on system fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({
        ...base,
        scopes: ["read", "write"],
        conditions: [{ key: "system.size", op: "gt", value: 0 }],
        writeStamp: { project: "alpha" },
      }),
    ).toThrow();
  });

  it("rejects a writeStamp that does not satisfy the conditions", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({
        ...base,
        scopes: ["read", "write"],
        writeStamp: { project: "beta" },
      }),
    ).toThrow();
  });

  it("accepts a write grant whose stamp satisfies every condition", () => {
    const grant = Schema.decodeUnknownSync(CreateShareGrant)({
      ...base,
      scopes: ["read", "write"],
      writeStamp: { project: "alpha" },
      maxItems: 10,
    });
    expect(grant.writeStamp).toEqual({ project: "alpha" });
    expect(grant.maxItems).toBe(10);
  });

  it("rejects zero/negative quotas", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({ ...base, scopes: ["read"], maxItems: 0 }),
    ).toThrow();
  });

  it("allows empty conditions (a share-everything grant)", () => {
    const grant = Schema.decodeUnknownSync(CreateShareGrant)({
      ...base,
      scopes: ["read"],
      conditions: [],
    });
    expect(grant.conditions).toEqual([]);
  });
});

describe("share principal + redaction", () => {
  it("decodes a principal with and without a share context", () => {
    expect(
      Schema.decodeUnknownSync(Principal)({ tenantId: "t", scopes: ["read"], via: "session" }).via,
    ).toBe("session");
    const shared = Schema.decodeUnknownSync(Principal)({
      tenantId: "t",
      scopes: ["read", "write"],
      via: "share",
      share: {
        grantId: "g1",
        conditions: [{ key: "project", op: "eq", value: "alpha" }],
        writeStamp: { project: "alpha" },
        limits: { maxItemBytes: null, maxTotalBytes: 1000, maxItems: null },
      },
    });
    expect(shared.share?.grantId).toBe("g1");
  });

  it("strips exactly the three tenant-internal fields", () => {
    const item = sampleItem();
    const shared = toSharedItem(item);
    expect(shared).not.toHaveProperty("tenantId");
    expect(shared).not.toHaveProperty("storageKey");
    expect(shared).not.toHaveProperty("stagingKey");
    expect(shared.id).toBe(item.id);
    expect(shared.properties).toEqual(item.properties);
    expect(Object.keys(shared).length).toBe(Object.keys(item).length - 3);
  });
});
