import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BatchDelete, ItemId, Properties, Query } from "./index.js";

describe("schema", () => {
  it("rejects mixed arrays and reserved keys", () => {
    expect(() => Schema.decodeUnknownSync(Properties)({ tags: ["a", 1] })).toThrow();
    expect(() => Schema.decodeUnknownSync(Properties)({ "system.owner": "me" })).toThrow();
  });

  it("applies query defaults and rejects invalid operator values", () => {
    expect(Schema.decodeUnknownSync(Query)({})).toEqual({
      where: [],
      limit: 100,
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
    });
    expect(() => Schema.decodeUnknownSync(Query)({ search: "x".repeat(257) })).toThrow();
  });

  it("validates item ids at API boundaries", () => {
    expect(Schema.decodeUnknownSync(ItemId)("00000000-0000-0000-0000-000000000000")).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(() => Schema.decodeUnknownSync(ItemId)("not-a-uuid")).toThrow();
    expect(() => Schema.decodeUnknownSync(BatchDelete)({ ids: ["not-a-uuid"] })).toThrow();
  });
});
