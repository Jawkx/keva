import { describe, expect, it } from "vitest";
import { includesSearch, isGlobalSearchShortcut, metadataSuggestionUrl } from "./global-search";

describe("global search helpers", () => {
  it("matches substrings without case sensitivity", () => {
    expect(includesSearch("Quarterly Finance", "fin")).toBe(true);
    expect(includesSearch("Quarterly Finance", "legal")).toBe(false);
  });

  it("builds exact metadata filter destinations", () => {
    const valueUrl = metadataSuggestionUrl({ key: "department", value: "Finance" });
    const keyUrl = metadataSuggestionUrl({ key: "priority" });

    expect(new URL(valueUrl, "https://keva.invalid").searchParams.get("filter")).toBe(
      JSON.stringify([{ key: "department", op: "has_value", value: "Finance" }]),
    );
    expect(new URL(keyUrl, "https://keva.invalid").searchParams.get("filter")).toBe(
      JSON.stringify([{ key: "priority", op: "exists" }]),
    );
  });

  it("recognizes the global search shortcut", () => {
    expect(isGlobalSearchShortcut({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isGlobalSearchShortcut({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isGlobalSearchShortcut({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
  });
});
