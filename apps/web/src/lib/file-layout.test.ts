import { describe, expect, it } from "vitest";
import { FILE_LAYOUT_STORAGE_KEY, readFileLayout } from "./file-layout";

describe("readFileLayout", () => {
  it("reads a persisted grid preference", () => {
    expect(
      readFileLayout({ getItem: (key) => (key === FILE_LAYOUT_STORAGE_KEY ? "grid" : null) }),
    ).toBe("grid");
  });

  it("defaults invalid, missing, and inaccessible preferences to list", () => {
    expect(readFileLayout({ getItem: () => "tiles" })).toBe("list");
    expect(readFileLayout({ getItem: () => null })).toBe("list");
    expect(
      readFileLayout({
        getItem: () => {
          throw new Error("Storage unavailable");
        },
      }),
    ).toBe("list");
  });
});
