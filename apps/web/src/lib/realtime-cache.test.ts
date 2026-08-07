import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "@keva/schema";
import {
  itemContentQueryKey,
  itemEventsQueryKey,
  itemListsQueryKey,
  itemQueryKey,
  propertyKeysQueryKey,
  propertySummaryQueryKey,
  propertyValuesQueryKey,
  shareItemsQueryKey,
  usageQueryKey,
} from "./items-cache";
import { invalidateRealtimeEvent, invalidateRealtimeRecovery } from "./realtime-cache";

const event = (overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  id: "00000000-0000-4000-8000-000000000001",
  type: "items.changed",
  reason: "patched",
  itemId: "00000000-0000-4000-8000-000000000002",
  occurredAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const seed = (client: QueryClient, keys: readonly (readonly unknown[])[]) => {
  for (const key of keys) client.setQueryData(key, {});
};

const invalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated;

describe("realtime cache", () => {
  it("invalidates broad mutable roots for recovery", () => {
    const client = new QueryClient();
    const roots = [
      itemListsQueryKey,
      ["trash"],
      usageQueryKey,
      propertySummaryQueryKey,
      propertyKeysQueryKey,
      propertyValuesQueryKey("project"),
    ] as const;
    const shareKey = shareItemsQueryKey("shared");
    seed(client, [...roots, shareKey]);

    invalidateRealtimeRecovery(client);

    for (const key of roots) expect(invalidated(client, key)).toBe(true);
    expect(invalidated(client, shareKey)).toBe(false);
  });

  it("invalidates only the changed item's mutable detail roots", () => {
    const client = new QueryClient();
    const itemA = event().itemId!;
    const itemB = "00000000-0000-4000-8000-000000000003";
    const targeted = [
      itemQueryKey(itemA),
      ["trash-item", itemA],
      itemEventsQueryKey(itemA),
    ] as const;
    const untouched = [
      itemQueryKey(itemB),
      itemEventsQueryKey(itemB),
      itemContentQueryKey(itemA),
    ] as const;
    seed(client, [...targeted, ...untouched]);

    invalidateRealtimeEvent(client, event());

    for (const key of targeted) expect(invalidated(client, key)).toBe(true);
    for (const key of untouched) expect(invalidated(client, key)).toBe(false);
  });

  it("invalidates thumbnails only when a thumbnail is deleted", () => {
    const client = new QueryClient();
    const itemId = event().itemId!;
    const keys = [
      ["thumbnail", itemId],
      ["trash-thumbnail", itemId],
    ] as const;
    seed(client, keys);

    invalidateRealtimeEvent(client, event({ reason: "patched" }));
    for (const key of keys) expect(invalidated(client, key)).toBe(false);

    invalidateRealtimeEvent(client, event({ reason: "thumbnail_deleted" }));
    for (const key of keys) expect(invalidated(client, key)).toBe(true);
  });
});
