import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { RealtimeHub, makeDurableObjectRealtimeGateway } from "./realtime-durable-object.js";

const event = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  type: "items.changed" as const,
  reason: "bulk_changed" as const,
  occurredAt: "2026-06-24T12:00:00.000Z",
};

describe("durable object realtime", () => {
  it("routes publish and stream to the tenant object and schedules publication", async () => {
    const requests: Request[] = [];
    const names: string[] = [];
    const pending: Promise<unknown>[] = [];
    const stub = { fetch: async (request: Request) => (requests.push(request), new Response()) };
    const gateway = makeDurableObjectRealtimeGateway(
      { idFromName: (name) => (names.push(name), name), get: () => stub },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Effect.runPromise(gateway.publisher.publish("tenant-a", event));
    await Promise.all(pending);
    await gateway.stream("tenant-a", new AbortController().signal);
    expect(names).toEqual(["tenant-a", "tenant-a"]);
    expect(new URL(requests[0]!.url).pathname).toBe("/publish");
    expect(await requests[0]!.clone().json()).toEqual(event);
    expect(new URL(requests[1]!.url).pathname).toBe("/stream");
    expect(requests[1]!.headers.get("cookie")).toBeNull();
  });

  it("absorbs rejected publication and validates internal payloads", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending: Promise<unknown>[] = [];
    const gateway = makeDurableObjectRealtimeGateway(
      {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => Promise.reject(new Error()) }),
      },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Effect.runPromise(gateway.publisher.publish("tenant", event));
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();

    const hub = new RealtimeHub();
    const invalid = await hub.fetch(
      new Request("https://internal/publish", {
        method: "POST",
        body: JSON.stringify({ ...event, tenantId: "tenant" }),
      }),
    );
    expect(invalid.status).toBe(400);
  });
});
