import { describe, expect, it } from "vitest";
import { uploadStampFrom } from "./upload-stamp";

describe("uploadStampFrom", () => {
  it("keeps scalar equality properties used by the current view", () => {
    expect(
      uploadStampFrom([
        { key: "project", op: "eq", value: "alpha" },
        { key: "priority", op: "eq", value: 3 },
        { key: "reviewed", op: "eq", value: true },
        { key: "archivedAt", op: "eq", value: null },
      ]),
    ).toEqual({ project: "alpha", priority: 3, reviewed: true, archivedAt: null });
  });

  it("stamps exists filters with true", () => {
    expect(
      uploadStampFrom([
        { key: "finance", op: "exists" },
        { key: "reviewed", op: "exists" },
      ]),
    ).toEqual({ finance: true, reviewed: true });
  });

  it("does not stamp system fields, arrays, or unsupported filters", () => {
    expect(
      uploadStampFrom([
        { key: "system.source", op: "eq", value: "web" },
        { key: "system.createdAt", op: "exists" },
        { key: "name", op: "eq", value: "report.pdf" },
        { key: "name", op: "exists" },
        { key: "project", op: "in", value: ["alpha", "beta"] },
        { key: "priority", op: "gte", value: 2 },
      ]),
    ).toEqual({});
  });
});
