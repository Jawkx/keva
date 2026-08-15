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

export const publishMediaResults = async (
  realtime: RealtimeGateway,
  result: MediaDrainResult,
): Promise<void> => {
  const occurredAt = new Date().toISOString();
  await Promise.all(
    [
      ...(result.readyItems ?? []).map((item) => ({ ...item, reason: "thumbnail_ready" as const })),
      ...(result.failedItems ?? []).map((item) => ({
        ...item,
        reason: "thumbnail_failed" as const,
      })),
    ].map(({ tenantId, itemId, reason }) =>
      Effect.runPromise(
        realtime.publisher.publish(tenantId, {
          id: randomUUID(),
          type: "items.changed",
          reason,
          itemId,
          occurredAt,
        }),
      ),
    ),
  );
};
