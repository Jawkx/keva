import { QueryOrder } from "@keva/schema";
import { Schema } from "effect";

export type FileSortColumn = "createdAt" | "updatedAt" | "name" | "size";

export const DEFAULT_FILE_ORDER: QueryOrder = "created_at_desc";

const FILE_ORDERS = new Set<QueryOrder>([
  "created_at_asc",
  "created_at_desc",
  "size_asc",
  "size_desc",
  "name_asc",
  "name_desc",
  "updated_at_asc",
  "updated_at_desc",
]);

export const fileOrderFromParam = (value: string | null): QueryOrder =>
  value !== null && Schema.is(QueryOrder)(value) && FILE_ORDERS.has(value)
    ? value
    : DEFAULT_FILE_ORDER;

export const fileSortColumn = (order: QueryOrder): FileSortColumn => {
  if (order.startsWith("size_")) return "size";
  if (order.startsWith("name_")) return "name";
  if (order.startsWith("updated_at_")) return "updatedAt";
  return "createdAt";
};

export const fileSortDirection = (order: QueryOrder): "ascending" | "descending" =>
  order.endsWith("_asc") ? "ascending" : "descending";

export const nextFileOrder = (order: QueryOrder, column: FileSortColumn): QueryOrder => {
  const active = fileSortColumn(order) === column;
  if (column === "size") return active && order === "size_desc" ? "size_asc" : "size_desc";
  if (column === "name") return active && order === "name_asc" ? "name_desc" : "name_asc";
  if (column === "updatedAt")
    return active && order === "updated_at_desc" ? "updated_at_asc" : "updated_at_desc";
  return active && order === "created_at_desc" ? "created_at_asc" : "created_at_desc";
};
