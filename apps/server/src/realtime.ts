import { ChangePublisher, type ChangePublisherService } from "@keva/core";
import { RealtimeEvent, type RealtimeEvent as RealtimeEventValue } from "@keva/schema";
import { Layer, Schema } from "effect";

export const REALTIME_HEARTBEAT_INTERVAL = 20_000;

export const realtimeHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

const decodeRealtimeEvent = Schema.decodeUnknownSync(RealtimeEvent, {
  onExcessProperty: "error",
});

export const validateRealtimeEvent = (value: unknown): RealtimeEventValue =>
  decodeRealtimeEvent(value);

export const encodeReadyFrame = (): string =>
  `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ version: 1 })}\n\n`;

export const encodeChangeFrame = (event: RealtimeEventValue): string =>
  `id: ${event.id}\nevent: items.changed\ndata: ${JSON.stringify(event)}\n\n`;

export const encodeHeartbeatFrame = (): string => ": heartbeat\n\n";

export interface RealtimeGateway {
  readonly publisher: ChangePublisherService;
  readonly stream: (tenantId: string, signal: AbortSignal) => Promise<Response>;
}

export const realtimePublisherLayer = (gateway: RealtimeGateway) =>
  Layer.succeed(ChangePublisher, gateway.publisher);
