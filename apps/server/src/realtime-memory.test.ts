import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { MemoryRealtimeGateway } from "./realtime-memory.js";

const event = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  type: "items.changed" as const,
  reason: "patched" as const,
  itemId: "123e4567-e89b-42d3-a456-426614174001",
  occurredAt: "2026-06-24T12:00:00.000Z",
};

const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  new TextDecoder().decode((await reader.read()).value);

describe("MemoryRealtimeGateway", () => {
  it("frames ready and isolates tenant delivery across multiple subscribers", async () => {
    const gateway = new MemoryRealtimeGateway();
    const abortA = new AbortController();
    const abortB = new AbortController();
    const abortOther = new AbortController();
    const readers = await Promise.all([
      gateway.stream("a", abortA.signal),
      gateway.stream("a", abortB.signal),
      gateway.stream("b", abortOther.signal),
    ]).then((responses) => responses.map((response) => response.body!.getReader()));
    expect(await read(readers[0]!)).toContain("event: ready");
    expect(await read(readers[1]!)).toContain("retry: 3000");
    expect(await read(readers[2]!)).toContain("event: ready");
    await Effect.runPromise(gateway.publisher.publish("a", event));
    expect(await read(readers[0]!)).toContain(`id: ${event.id}`);
    expect(await read(readers[1]!)).toContain('"reason":"patched"');
    abortA.abort();
    abortB.abort();
    abortOther.abort();
  });

  it("notifies a local publish observer with the validated event", async () => {
    const observer = vi.fn();
    const gateway = new MemoryRealtimeGateway(observer);

    await Effect.runPromise(gateway.publisher.publish("a", event));

    expect(observer).toHaveBeenCalledWith("a", event);
  });

  it("cleans heartbeat timers after abort and rejects excess payload fields", async () => {
    vi.useFakeTimers();
    const gateway = new MemoryRealtimeGateway();
    const abort = new AbortController();
    await gateway.stream("a", abort.signal);
    expect(vi.getTimerCount()).toBe(1);
    abort.abort();
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      Effect.runPromise(gateway.publisher.publish("a", { ...event, tenantId: "a" } as never)),
    ).rejects.toThrow();
    vi.useRealTimers();
  });
});
