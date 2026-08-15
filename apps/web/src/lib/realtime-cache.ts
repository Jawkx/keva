import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@keva/schema";
import {
  invalidatePropertyDiscovery,
  itemEventsQueryKey,
  itemListsQueryKey,
  itemQueryKey,
  usageQueryKey,
} from "./items-cache";

const invalidateSharedQueries = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: itemListsQueryKey });
  void queryClient.invalidateQueries({ queryKey: ["trash"] });
  void queryClient.invalidateQueries({ queryKey: usageQueryKey });
  invalidatePropertyDiscovery(queryClient);
};

export function invalidateRealtimeRecovery(queryClient: QueryClient) {
  invalidateSharedQueries(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["thumbnail"] });
}

export function invalidateRealtimeEvent(queryClient: QueryClient, event: RealtimeEvent) {
  invalidateSharedQueries(queryClient);
  if (!event.itemId) return;

  void queryClient.invalidateQueries({ queryKey: itemQueryKey(event.itemId) });
  void queryClient.invalidateQueries({ queryKey: ["trash-item", event.itemId] });
  void queryClient.invalidateQueries({ queryKey: itemEventsQueryKey(event.itemId) });

  if (
    event.reason === "thumbnail_deleted" ||
    event.reason === "thumbnail_ready" ||
    event.reason === "thumbnail_failed"
  ) {
    void queryClient.invalidateQueries({ queryKey: ["thumbnail", event.itemId] });
    void queryClient.invalidateQueries({ queryKey: ["trash-thumbnail", event.itemId] });
  }
}
