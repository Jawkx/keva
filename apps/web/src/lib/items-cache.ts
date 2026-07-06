import type { InfiniteData } from "@tanstack/react-query";
import type { QueryCondition, QueryOrder } from "@keva/schema";
import type { KevaItem, QueryResult } from "@keva/sdk";

export type ItemsCache = InfiniteData<QueryResult, string | undefined>;

export const itemsQueryKey = (
  search: string,
  where: readonly QueryCondition[],
  order: QueryOrder,
) => ["items", { search, where, order }] as const;

export function removeItemsFromPages(data: ItemsCache, ids: Iterable<string>): ItemsCache {
  const drop = new Set(ids);
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => !drop.has(item.id)),
    })),
  };
}

export function replaceItemInPages(data: ItemsCache, item: KevaItem): ItemsCache {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((existing) => (existing.id === item.id ? item : existing)),
    })),
  };
}

export function prependItemToPages(data: ItemsCache, item: KevaItem): ItemsCache {
  const [first, ...rest] = data.pages;
  if (!first) return data;
  return {
    ...data,
    pages: [{ ...first, items: [item, ...first.items] }, ...rest],
  };
}
