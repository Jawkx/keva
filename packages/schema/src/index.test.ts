import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BatchDelete, ItemId, Properties, Query, UsageResult } from "./index.js";

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
