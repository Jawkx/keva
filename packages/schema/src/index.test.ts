import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Attributes, Query } from "./index.js";

describe("schema", () => {
  it("rejects mixed arrays and reserved keys", () => {
    expect(() =>
      Schema.decodeUnknownSync(Attributes)({ tags: ["a", 1] }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Attributes)({ "system.owner": "me" }),
    ).toThrow();
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
});
