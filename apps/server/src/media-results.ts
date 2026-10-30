import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { RealtimeGateway } from "./realtime.js";

export interface ProcessedMediaItem {
  readonly tenantId: string;
  readonly itemId: string;
}

export interface MediaDrainResult {
  readonly readyItems?: readonly ProcessedMediaItem[];
  readonly failedItems?: readonly ProcessedMediaItem[];
}

export const publishMediaResults = (realtime: RealtimeGateway, result: MediaDrainResult) => {
  const occurredAt = new Date().toISOString();
  const items = [
    ...(result.readyItems ?? []).map((item) => ({ ...item, reason: "thumbnail_ready" as const })),
    ...(result.failedItems ?? []).map((item) => ({
      ...item,
      reason: "thumbnail_failed" as const,
    })),
  ];
  return Effect.forEach(
    items,
    ({ tenantId, itemId, reason }) =>
      realtime.publisher.publish(tenantId, {
        id: randomUUID(),
        type: "items.changed",
        reason,
        itemId,
        occurredAt,
      }),
    { concurrency: "unbounded", discard: true },
  );
};
