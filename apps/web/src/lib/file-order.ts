import type { QueryOrder } from "@keva/schema";

export type FileSortColumn = "createdAt" | "size";

export const DEFAULT_FILE_ORDER: QueryOrder = "created_at_desc";

const FILE_ORDERS = new Set<QueryOrder>([
  "created_at_asc",
  "created_at_desc",
  "size_asc",
  "size_desc",
]);

export const fileOrderFromParam = (value: string | null): QueryOrder =>
  value && FILE_ORDERS.has(value as QueryOrder) ? (value as QueryOrder) : DEFAULT_FILE_ORDER;

export const fileSortColumn = (order: QueryOrder): FileSortColumn =>
  order.startsWith("size_") ? "size" : "createdAt";

export const fileSortDirection = (order: QueryOrder): "ascending" | "descending" =>
  order.endsWith("_asc") ? "ascending" : "descending";

export const nextFileOrder = (order: QueryOrder, column: FileSortColumn): QueryOrder => {
  const active = fileSortColumn(order) === column;
  if (column === "size") return active && order === "size_desc" ? "size_asc" : "size_desc";
  return active && order === "created_at_desc" ? "created_at_asc" : "created_at_desc";
};
