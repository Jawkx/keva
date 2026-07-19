import { describe, expect, it } from "vitest";
import {
  buildFilterWhere,
  createConditionDraft,
  decodeFilterParam,
  draftFromConditions,
  inferScalar,
  operatorForValueCount,
  operatorsForKey,
  visibleOperator,
} from "./item-filters";

describe("item filters", () => {
  it("keeps custom values as strings and only parses system.size numerically", () => {
    expect(inferScalar("42", "priority")).toBe("42");
    expect(inferScalar("42", "system.size")).toBe(42);
  });

  it("builds scalar and array membership conditions", () => {
    expect(
      buildFilterWhere({
        kinds: [],
        size: "any",
        rows: [
          createConditionDraft("project", "has_value", ["keva"]),
          createConditionDraft("audience", "has_all", ["internal", "mobile"]),
        ],
      }),
    ).toEqual([
      { key: "project", op: "has_value", value: "keva" },
      { key: "audience", op: "has_all", value: ["internal", "mobile"] },
    ]);
  });

  it("canonicalizes value operators and operands at the query boundary", () => {
    const row = createConditionDraft("project", "has_value", ["alpha"]);
    const draft = { kinds: [], size: "any" as const, rows: [row] };

    expect(buildFilterWhere(draft)).toEqual([{ key: "project", op: "has_value", value: "alpha" }]);
    expect(buildFilterWhere({ ...draft, rows: [{ ...row, values: ["alpha", "beta"] }] })).toEqual([
      { key: "project", op: "has_any", value: ["alpha", "beta"] },
    ]);
    expect(buildFilterWhere({ ...draft, rows: [{ ...row, values: ["beta"] }] })).toEqual([
      { key: "project", op: "has_value", value: "beta" },
    ]);
    expect(
      buildFilterWhere({
        ...draft,
        rows: [{ ...row, op: "has_any", values: ["beta"] }],
      }),
    ).toEqual([{ key: "project", op: "has_value", value: "beta" }]);
  });

  it("round-trips loaded multi-value conditions without narrowing them", () => {
    const conditions = [{ key: "project", op: "has_any" as const, value: ["alpha", "beta"] }];

    expect(buildFilterWhere(draftFromConditions(conditions))).toEqual(conditions);
  });

  it("canonicalizes text operators while preserving explicit multi-value semantics", () => {
    expect(
      buildFilterWhere({
        kinds: [],
        size: "any",
        rows: [
          createConditionDraft("description", "contains_text", ["alpha", "beta"]),
          createConditionDraft("audience", "has_all", ["internal"]),
        ],
      }),
    ).toEqual([
      { key: "description", op: "contains_any", value: ["alpha", "beta"] },
      { key: "audience", op: "has_all", value: ["internal"] },
    ]);
  });

  it("collapses singular and plural query operators in the filter UI", () => {
    expect(operatorsForKey("project")).toEqual([
      "exists",
      "missing",
      "is_tag",
      "has_value",
      "contains_text",
    ]);
    expect(operatorsForKey("project", ["tag"])).toEqual(["exists", "missing"]);
    expect(operatorsForKey("project", ["string"])).toEqual([
      "exists",
      "missing",
      "has_value",
      "contains_text",
    ]);
    expect(operatorsForKey("project", ["array"])).toContain("has_all");
    expect(visibleOperator("has_any")).toBe("has_value");
    expect(visibleOperator("contains_any")).toBe("contains_text");
    expect(operatorForValueCount("has_value", 2)).toBe("has_any");
    expect(operatorForValueCount("has_any", 1)).toBe("has_value");
    expect(operatorForValueCount("contains_text", 2)).toBe("contains_any");
  });

  it("rejects malformed URL conditions with the shared schema", () => {
    expect(
      decodeFilterParam(
        JSON.stringify([
          { key: "project", op: "is_tag" },
          { key: "project", op: "has_all", value: [] },
          { key: "project", op: "unknown", value: "x" },
        ]),
      ),
    ).toEqual([{ key: "project", op: "is_tag" }]);
  });
});
