import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itemListsQueryKey, itemQueryKey } from "./items-cache";
import { subscribeToRealtime, type EventSourceConstructor } from "./realtime-client";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  readonly close = vi.fn();

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  emit(type: string, data = "") {
    this.listeners.get(type)?.({ data } as MessageEvent);
  }
}

const validEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "items.changed",
  reason: "patched",
  itemId: "00000000-0000-4000-8000-000000000002",
  occurredAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  FakeEventSource.instances = [];
  vi.restoreAllMocks();
});

describe("realtime client", () => {
  it("subscribes with credentials, recovers on every open, and closes once", () => {
    const client = new QueryClient();
    client.setQueryData(itemListsQueryKey, []);
    const cleanup = subscribeToRealtime(client, FakeEventSource as EventSourceConstructor);
    const source = FakeEventSource.instances[0]!;

    expect(source.url).toBe("/api/events");
    expect(source.options).toEqual({ withCredentials: true });
    source.emit("open");
    expect(client.getQueryState(itemListsQueryKey)?.isInvalidated).toBe(true);
    client.setQueryData(itemListsQueryKey, []);
    source.emit("open");
    expect(client.getQueryState(itemListsQueryKey)?.isInvalidated).toBe(true);

    cleanup();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("strictly parses events and ignores malformed payloads", () => {
    const client = new QueryClient();
    const key = itemQueryKey(validEvent.itemId);
    client.setQueryData(key, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    subscribeToRealtime(client, FakeEventSource as EventSourceConstructor);
    const source = FakeEventSource.instances[0]!;

    source.emit("items.changed", "not json");
    source.emit("items.changed", JSON.stringify({ ...validEvent, tenantId: "secret" }));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);

    source.emit("items.changed", JSON.stringify(validEvent));
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
