import { describe, expect, it } from "vitest";
import { visiblePaginationItems } from "./NumberedPagination";

describe("visiblePaginationItems", () => {
  it("shows every page for short result sets", () => {
    expect(visiblePaginationItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the current page and boundaries for long result sets", () => {
    expect(visiblePaginationItems(8, 20)).toEqual([1, "ellipsis", 7, 8, 9, "ellipsis", 20]);
  });

  it("does not add an ellipsis beside a boundary", () => {
    expect(visiblePaginationItems(2, 20)).toEqual([1, 2, 3, "ellipsis", 20]);
    expect(visiblePaginationItems(19, 20)).toEqual([1, "ellipsis", 18, 19, 20]);
  });
});
