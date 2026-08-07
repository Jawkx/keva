import type { QueryClient } from "@tanstack/react-query";
import { RealtimeEvent } from "@keva/schema";
import { Schema } from "effect";
import { invalidateRealtimeEvent, invalidateRealtimeRecovery } from "./realtime-cache";

interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type EventSourceConstructor = new (
  url: string,
  eventSourceInitDict?: EventSourceInit,
) => EventSourceLike;

const decodeRealtimeEvent = Schema.decodeUnknownSync(RealtimeEvent, {
  onExcessProperty: "error",
});

export function subscribeToRealtime(
  queryClient: QueryClient,
  EventSourceImpl: EventSourceConstructor = EventSource,
) {
  const source = new EventSourceImpl("/api/events", { withCredentials: true });
  source.addEventListener("open", () => invalidateRealtimeRecovery(queryClient));
  source.addEventListener("error", () => undefined);
  source.addEventListener("items.changed", (message) => {
    try {
      invalidateRealtimeEvent(queryClient, decodeRealtimeEvent(JSON.parse(message.data)));
    } catch {
      console.warn("Ignored malformed realtime event");
    }
  });
  return () => source.close();
}
