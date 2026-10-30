import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { TestRealtimeGateway } from "./test/realtime-gateway.js";
import { publishMediaResults } from "./media-results.js";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

describe("publishMediaResults", () => {
  it("publishes each result only to its owning tenant", async () => {
    const published: { tenantId: string; reason: string; itemId: string | undefined }[] = [];
    const realtime = new TestRealtimeGateway((tenantId, event) => {
      published.push({ tenantId, reason: event.reason, itemId: event.itemId });
    });

    await Effect.runPromise(
      publishMediaResults(realtime, {
        readyItems: [{ tenantId: "tenant-a", itemId: id("01") }],
        failedItems: [{ tenantId: "tenant-b", itemId: id("02") }],
      }),
    );

    expect(published).toEqual([
      { tenantId: "tenant-a", reason: "thumbnail_ready", itemId: id("01") },
      { tenantId: "tenant-b", reason: "thumbnail_failed", itemId: id("02") },
    ]);
  });
});
