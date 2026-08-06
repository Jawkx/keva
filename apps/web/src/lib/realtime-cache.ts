import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@keva/schema";
import {
  invalidatePropertyDiscovery,
  itemEventsQueryKey,
  itemListsQueryKey,
  itemQueryKey,
  usageQueryKey,
} from "./items-cache";

export function invalidateRealtimeRecovery(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: itemListsQueryKey });
  void queryClient.invalidateQueries({ queryKey: ["trash"] });
  void queryClient.invalidateQueries({ queryKey: usageQueryKey });
  invalidatePropertyDiscovery(queryClient);
}

export function invalidateRealtimeEvent(queryClient: QueryClient, event: RealtimeEvent) {
  invalidateRealtimeRecovery(queryClient);
  if (!event.itemId) return;

  void queryClient.invalidateQueries({ queryKey: itemQueryKey(event.itemId) });
  void queryClient.invalidateQueries({ queryKey: ["trash-item", event.itemId] });
  void queryClient.invalidateQueries({ queryKey: itemEventsQueryKey(event.itemId) });

  if (event.reason === "thumbnail_deleted") {
    void queryClient.invalidateQueries({ queryKey: ["thumbnail", event.itemId] });
    void queryClient.invalidateQueries({ queryKey: ["trash-thumbnail", event.itemId] });
  }
}
