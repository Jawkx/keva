import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_ORDER,
  fileOrderFromParam,
  fileSortColumn,
  fileSortDirection,
  nextFileOrder,
} from "./file-order";

describe("file ordering", () => {
  it("defaults invalid and absent URL values", () => {
    expect(fileOrderFromParam(null)).toBe(DEFAULT_FILE_ORDER);
    expect(fileOrderFromParam("random_asc")).toBe(DEFAULT_FILE_ORDER);
  });

  it("reads supported URL values", () => {
    expect(fileOrderFromParam("size_asc")).toBe("size_asc");
    expect(fileOrderFromParam("created_at_asc")).toBe("created_at_asc");
    expect(fileOrderFromParam("name_asc")).toBe("name_asc");
    expect(fileOrderFromParam("updated_at_desc")).toBe("updated_at_desc");
  });

  it("switches columns descending first and toggles the active column", () => {
    expect(nextFileOrder("created_at_desc", "size")).toBe("size_desc");
    expect(nextFileOrder("size_desc", "size")).toBe("size_asc");
    expect(nextFileOrder("size_asc", "createdAt")).toBe("created_at_desc");
    expect(nextFileOrder("created_at_desc", "createdAt")).toBe("created_at_asc");
    expect(nextFileOrder("created_at_desc", "name")).toBe("name_asc");
    expect(nextFileOrder("name_asc", "name")).toBe("name_desc");
    expect(nextFileOrder("name_desc", "updatedAt")).toBe("updated_at_desc");
  });

  it("maps API orders to table state", () => {
    expect(fileSortColumn("size_desc")).toBe("size");
    expect(fileSortColumn("name_asc")).toBe("name");
    expect(fileSortColumn("updated_at_desc")).toBe("updatedAt");
    expect(fileSortDirection("size_desc")).toBe("descending");
    expect(fileSortDirection("created_at_asc")).toBe("ascending");
  });
});
