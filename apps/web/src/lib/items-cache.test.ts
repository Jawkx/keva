import { describe, expect, it } from "vitest";
import type { KevaItem, QueryResult } from "@keva/sdk";
import { prependItemToPages, removeItemsFromPages, replaceItemInPages } from "./items-cache";

const item = (id: string, name = id): KevaItem => ({
  id,
  name,
  contentType: "text/plain",
  declaredSize: 1,
  size: 1,
  etag: null,
  source: "upload",
  status: "ready",
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  properties: {},
});

const result = (items: KevaItem[]): QueryResult => ({ items, totalCount: items.length });

describe("items cache", () => {
  it("removes deleted items from a paginated query result", () => {
    const updated = removeItemsFromPages(result([item("one"), item("two")]), ["one"]);

    expect(updated.items.map(({ id }) => id)).toEqual(["two"]);
    expect(updated.totalCount).toBe(1);
  });

  it("replaces an item in a paginated query result", () => {
    const updated = replaceItemInPages(result([item("one")]), item("one", "Updated"));

    expect(updated.items[0]?.name).toBe("Updated");
  });

  it("prepends an item and updates the result count", () => {
    const updated = prependItemToPages(result([item("two")]), item("one"));

    expect(updated.items.map(({ id }) => id)).toEqual(["one", "two"]);
    expect(updated.totalCount).toBe(2);
  });
});
