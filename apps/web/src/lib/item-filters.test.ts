import { describe, expect, it } from "vitest";
import {
  buildFilterWhere,
  createConditionDraft,
  decodeFilterParam,
  inferScalar,
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
