import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BatchDelete,
  CreateShareGrant,
  CreateView,
  ItemId,
  itemMatchesCondition,
  type KevaItem,
  Principal,
  Properties,
  propertyValuesEqual,
  propertiesMatchCondition,
  Query,
  toOwnerItem,
  toSharedItem,
  UpdateView,
  UsageResult,
  validateProperties,
} from "./index.js";

describe("schema", () => {
  it("rejects invalid arrays, legacy scalars, and reserved keys", () => {
    expect(() => Schema.decodeUnknownSync(Properties)({ tags: ["a", 1] })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ tags: [] })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ tags: ["a", "a"] })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ empty: "" })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ rating: 5 })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ enabled: true })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ "system.owner": "me" })).toThrow();
  });

  it("reports complete-property limit failures without decoder errors", () => {
    expect(validateProperties({ "system.owner": "me" })).toBe("invalid-key");
    expect(
      validateProperties(
        Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key-${index}`, "x"])),
      ),
    ).toBe("too-many-keys");
    expect(validateProperties({ note: "x".repeat(8 * 1024 + 1) })).toBe("invalid-value");
  });

  it("applies query defaults and rejects invalid operator values", () => {
    expect(Schema.decodeUnknownSync(Query)({})).toEqual({
      where: [],
      limit: 100,
      order: "created_at_asc",
    });
    expect(() =>
      Schema.decodeUnknownSync(Query)({
        where: [{ key: "rating", op: "eq", value: "x" }],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Query)({
        where: [{ key: "system.unknown", op: "exists" }],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Query)({
        where: [{ key: "keva.internal", op: "exists" }],
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(Query)({
        where: [
          {
            key: "system.content_type",
            op: "contains_any",
            value: ["text/", "application/pdf"],
          },
        ],
      }).where,
    ).toEqual([
      { key: "system.content_type", op: "contains_any", value: ["text/", "application/pdf"] },
    ]);
    expect(() =>
      Schema.decodeUnknownSync(Query)({ where: [{ key: "kind", op: "has_any", value: "doc" }] }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Query)({ where: [{ key: "kind", op: "has_any", value: [] }] }),
    ).toThrow();
  });

  it("validates operators against custom and system field types", () => {
    const decode = Schema.decodeUnknownSync(Query);
    expect(
      decode({ where: [{ key: "tags", op: "has_all", value: ["a", "b"] }] }).where,
    ).toHaveLength(1);
    expect(decode({ where: [{ key: "system.etag", op: "neq", value: null }] }).where).toHaveLength(
      1,
    );
    expect(
      decode({ where: [{ key: "system.created_at", op: "gt", value: "2026-01-01T00:00:00Z" }] })
        .where,
    ).toHaveLength(1);
    expect(() => decode({ where: [{ key: "tag", op: "eq", value: "x" }] })).toThrow();
    expect(() => decode({ where: [{ key: "name", op: "has_value", value: "x" }] })).toThrow();
    expect(() => decode({ where: [{ key: "name", op: "eq", value: null }] })).toThrow();
    expect(() => decode({ where: [{ key: "name", op: "exists" }] })).toThrow();
    expect(() =>
      decode({ where: [{ key: "system.created_at", op: "gt", value: "yesterday" }] }),
    ).toThrow();
    expect(() => decode({ where: [{ key: "tags", op: "has_any", value: ["a", "a"] }] })).toThrow();
  });

  it("compares array property values as unordered sets", () => {
    expect(propertyValuesEqual(["a", "b"], ["b", "a"])).toBe(true);
    expect(propertyValuesEqual(["a"], ["b"])).toBe(false);
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
      quotaBytes: 10_737_418_240,
      remainingBytes: 10_737_414_144,
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
  properties: { project: "alpha", tags: ["x", "y"], label: null },
  ...overrides,
});

describe("condition evaluator", () => {
  it("evaluates property conditions across operators", () => {
    const item = sampleItem();
    expect(itemMatchesCondition(item, { key: "project", op: "has_value", value: "alpha" })).toBe(
      true,
    );
    expect(itemMatchesCondition(item, { key: "project", op: "exists" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "missing", op: "exists" })).toBe(false);
    expect(itemMatchesCondition(item, { key: "missing", op: "missing" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "tags", op: "has_value", value: "x" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "tags", op: "has_value", value: "z" })).toBe(false);
    expect(
      itemMatchesCondition(item, { key: "project", op: "has_any", value: ["beta", "alpha"] }),
    ).toBe(true);
    expect(
      itemMatchesCondition(item, { key: "project", op: "has_any", value: ["beta", "gamma"] }),
    ).toBe(false);
    expect(itemMatchesCondition(item, { key: "tags", op: "has_all", value: ["y", "x"] })).toBe(
      true,
    );
    expect(itemMatchesCondition(item, { key: "label", op: "is_tag" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "tags", op: "contains_text", value: "y" })).toBe(true);
    expect(
      itemMatchesCondition(item, {
        key: "system.content_type",
        op: "contains_any",
        value: ["text/", "application/pdf"],
      }),
    ).toBe(true);
    expect(
      itemMatchesCondition(item, {
        key: "system.content_type",
        op: "contains_any",
        value: ["image/"],
      }),
    ).toBe(false);
  });

  it("resolves declared system fields for items", () => {
    const item = sampleItem();
    expect(itemMatchesCondition(item, { key: "name", op: "eq", value: "report.pdf" })).toBe(true);
    expect(itemMatchesCondition(item, { key: "system.size", op: "gte", value: 2048 })).toBe(true);
    expect(itemMatchesCondition(item, { key: "system.size", op: "gt", value: 4096 })).toBe(false);
    expect(
      itemMatchesCondition(item, {
        key: "system.created_at",
        op: "eq",
        value: "2025-12-31T19:00:00-05:00",
      }),
    ).toBe(true);
    expect(
      itemMatchesCondition(item, {
        key: "system.created_at",
        op: "lt",
        value: "2026-01-01T00:00:01Z",
      }),
    ).toBe(true);
  });

  it("evaluates property-blob conditions without an item", () => {
    const stamp = { project: "alpha" };
    expect(
      propertiesMatchCondition(stamp, { key: "project", op: "has_value", value: "alpha" }),
    ).toBe(true);
    expect(propertiesMatchCondition(stamp, { key: "project", op: "exists" })).toBe(true);
    expect(propertiesMatchCondition(stamp, { key: "other", op: "exists" })).toBe(false);
  });
});

describe("CreateShareGrant", () => {
  const base = {
    name: "Client drop",
    viewId: "v1",
  };

  it("accepts a read-only grant", () => {
    const grant = Schema.decodeUnknownSync(CreateShareGrant)({ ...base, scopes: ["read"] });
    expect(grant.scopes).toEqual(["read"]);
    expect(grant.viewId).toBe("v1");
  });

  it("requires a viewId", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({ name: "x", scopes: ["read"] }),
    ).toThrow();
  });

  it("requires a writeStamp for write grants", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateShareGrant)({ ...base, scopes: ["write"] }),
    ).toThrow();
  });

  it("accepts a write grant that carries a writeStamp", () => {
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
});

describe("CreateView / UpdateView", () => {
  it("decodes a view with conditions", () => {
    const view = Schema.decodeUnknownSync(CreateView)({
      name: "Diving",
      conditions: [{ key: "trip", op: "has_value", value: "iceland" }],
    });
    expect(view.conditions).toHaveLength(1);
  });

  it("decodes an optional icon on create", () => {
    const view = Schema.decodeUnknownSync(CreateView)({
      name: "Diving",
      icon: "star",
      conditions: [],
    });
    expect(view.icon).toBe("star");
  });

  it("accepts an empty UpdateView (no-op patch)", () => {
    expect(Schema.decodeUnknownSync(UpdateView)({})).toEqual({});
  });

  it("decodes an icon-only UpdateView patch", () => {
    expect(Schema.decodeUnknownSync(UpdateView)({ icon: "folder" })).toEqual({ icon: "folder" });
  });
});

describe("share principal + redaction", () => {
  it("requires share context only for share principals", () => {
    expect(
      Schema.decodeUnknownSync(Principal)({ tenantId: "t", scopes: ["read"], via: "session" }).via,
    ).toBe("session");
    const shared = Schema.decodeUnknownSync(Principal)({
      tenantId: "t",
      scopes: ["read", "write"],
      via: "share",
      share: {
        grantId: "g1",
        conditions: [{ key: "project", op: "has_value", value: "alpha" }],
        writeStamp: { project: "alpha" },
        limits: { maxItemBytes: null, maxTotalBytes: 1000, maxItems: null },
      },
    });
    expect(shared.via).toBe("share");
    if (shared.via === "share") expect(shared.share.grantId).toBe("g1");
    expect(() =>
      Schema.decodeUnknownSync(Principal)({ tenantId: "t", scopes: ["read"], via: "share" }),
    ).toThrow();
  });

  it("strips exactly the three tenant-internal fields from public item DTOs", () => {
    const item = sampleItem();
    const shared = toSharedItem(item);
    const owner = toOwnerItem(item);
    expect(shared).not.toHaveProperty("tenantId");
    expect(shared).not.toHaveProperty("storageKey");
    expect(shared).not.toHaveProperty("stagingKey");
    expect(owner).not.toHaveProperty("tenantId");
    expect(owner).not.toHaveProperty("storageKey");
    expect(owner).not.toHaveProperty("stagingKey");
    expect(shared.id).toBe(item.id);
    expect(owner).toEqual(shared);
    expect(shared.properties).toEqual(item.properties);
    expect(Object.keys(shared).length).toBe(Object.keys(item).length - 3);
  });
});
