import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { QueryCondition, QueryOrder } from "@keva/schema";
import type { KevaItem, QueryResult } from "@keva/sdk";
import { revokeObjectUrl } from "./object-url-cache";

export type ItemsCache = InfiniteData<QueryResult, string | undefined>;

export const itemListsQueryKey = ["items"] as const;

export const itemQueryKey = (itemId: string) => ["item", itemId] as const;

export const itemContentQueryKey = (itemId: string) => ["content", itemId] as const;

export const itemEventsQueryKey = (itemId: string) => ["item-events", itemId] as const;

export const usageQueryKey = ["usage"] as const;

export const propertySummaryQueryKey = ["property-summary"] as const;

export const propertyKeysQueryKey = ["property-keys"] as const;

export const propertyValuesQueryRoot = ["property-values"] as const;

export const propertyValuesQueryKey = (key: string) => ["property-values", key] as const;

export const shareSelfQueryKey = ["share-self"] as const;

export const shareItemsQueryRoot = ["share-items"] as const;

export const shareItemsQueryKey = (search: string) => ["share-items", search] as const;

export const shareItemQueryKey = (itemId: string) => ["share-item", itemId] as const;

export const shareContentQueryKey = (itemId: string) => ["share-content", itemId] as const;

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

const invalidatePropertyDiscovery = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: propertySummaryQueryKey });
  void queryClient.invalidateQueries({ queryKey: propertyKeysQueryKey });
  void queryClient.invalidateQueries({ queryKey: propertyValuesQueryRoot });
};

export function cacheConfirmedItemUpload(
  queryClient: QueryClient,
  item: KevaItem,
  options: {
    readonly listQueryKey?: ReturnType<typeof itemsQueryKey>;
    readonly refetchLists: boolean;
  },
) {
  if (!options.refetchLists && options.listQueryKey) {
    const activeKey = JSON.stringify(options.listQueryKey);
    queryClient.setQueryData<ItemsCache>(options.listQueryKey, (old) =>
      old ? prependItemToPages(old, item) : old,
    );
    // The active list was updated optimistically; invalidate only the other
    // lists so it does not refetch and flicker the just-added row.
    void queryClient.invalidateQueries({
      queryKey: itemListsQueryKey,
      predicate: (query) => JSON.stringify(query.queryKey) !== activeKey,
    });
  } else {
    void queryClient.invalidateQueries({ queryKey: itemListsQueryKey });
  }
  void queryClient.invalidateQueries({ queryKey: usageQueryKey });
  invalidatePropertyDiscovery(queryClient);
}

export function cachePatchedItem(queryClient: QueryClient, item: KevaItem) {
  queryClient.setQueryData(itemQueryKey(item.id), item);
  queryClient.setQueriesData<ItemsCache>({ queryKey: itemListsQueryKey }, (old) =>
    old ? replaceItemInPages(old, item) : old,
  );
  void queryClient.invalidateQueries({ queryKey: itemListsQueryKey });
  void queryClient.invalidateQueries({ queryKey: itemEventsQueryKey(item.id) });
  invalidatePropertyDiscovery(queryClient);
}

export function removeDeletedItemsFromCache(queryClient: QueryClient, ids: Iterable<string>) {
  const deletedIds = [...new Set(ids)];
  if (deletedIds.length === 0) return;

  queryClient.setQueriesData<ItemsCache>({ queryKey: itemListsQueryKey }, (old) =>
    old ? removeItemsFromPages(old, deletedIds) : old,
  );
  for (const itemId of deletedIds) {
    queryClient.removeQueries({ queryKey: itemQueryKey(itemId), exact: true });
    queryClient.removeQueries({ queryKey: itemContentQueryKey(itemId), exact: true });
    queryClient.removeQueries({ queryKey: itemEventsQueryKey(itemId), exact: true });
    revokeObjectUrl("owner", itemId);
  }
  void queryClient.invalidateQueries({ queryKey: usageQueryKey });
  invalidatePropertyDiscovery(queryClient);
}

export function cacheConfirmedShareUpload(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: shareItemsQueryRoot });
  void queryClient.invalidateQueries({ queryKey: shareSelfQueryKey });
}
