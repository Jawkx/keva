import { describe, expect, it } from "vitest";
import { uploadStampFrom } from "./upload-stamp";

describe("uploadStampFrom", () => {
  it("stamps exact custom property conditions", () => {
    expect(
      uploadStampFrom([
        { key: "project", op: "has_value", value: "alpha" },
        { key: "audiences", op: "has_all", value: ["internal", "mobile"] },
        { key: "featured", op: "is_tag" },
      ]),
    ).toEqual({ project: "alpha", audiences: ["internal", "mobile"], featured: null });
  });

  it("stamps exists filters as tags", () => {
    expect(
      uploadStampFrom([
        { key: "finance", op: "exists" },
        { key: "reviewed", op: "exists" },
      ]),
    ).toEqual({ finance: null, reviewed: null });
  });

  it("merges compatible requirements for the same key", () => {
    expect(
      uploadStampFrom([
        { key: "finance", op: "exists" },
        { key: "finance", op: "has_value", value: "approved" },
        { key: "audience", op: "has_value", value: "mobile" },
        { key: "audience", op: "has_value", value: "internal" },
      ]),
    ).toEqual({ finance: "approved", audience: ["internal", "mobile"] });
  });

  it("does not stamp system fields or ambiguous alternatives", () => {
    expect(
      uploadStampFrom([
        { key: "system.source", op: "eq", value: "web" },
        { key: "system.created_at", op: "exists" },
        { key: "name", op: "eq", value: "report.pdf" },
        { key: "name", op: "exists" },
        { key: "project", op: "has_any", value: ["alpha", "beta"] },
        { key: "priority", op: "contains_text", value: "2" },
        { key: "conflict", op: "has_value", value: "a" },
        { key: "conflict", op: "has_value", value: "b" },
      ]),
    ).toEqual({ priority: "2", conflict: ["a", "b"] });
  });
});
