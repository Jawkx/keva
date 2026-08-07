import { Effect } from "effect";
import {
  REALTIME_HEARTBEAT_INTERVAL,
  encodeChangeFrame,
  encodeHeartbeatFrame,
  encodeReadyFrame,
  realtimeHeaders,
  validateRealtimeEvent,
  type RealtimeGateway,
} from "./realtime.js";

interface TenantSubscribers {
  readonly controllers: Set<ReadableStreamDefaultController<Uint8Array>>;
  readonly heartbeat: ReturnType<typeof setInterval>;
}

const encoder = new TextEncoder();

export class MemoryRealtimeGateway implements RealtimeGateway {
  private readonly tenants = new Map<string, TenantSubscribers>();

  readonly publisher = {
    publish: (tenantId: string, value: unknown) =>
      Effect.sync(() => {
        const event = validateRealtimeEvent(value);
        const frame = encoder.encode(encodeChangeFrame(event));
        for (const controller of this.tenants.get(tenantId)?.controllers ?? []) {
          controller.enqueue(frame);
        }
      }),
  };

  readonly stream = async (tenantId: string, signal: AbortSignal): Promise<Response> => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", abort);
      const tenant = this.tenants.get(tenantId);
      if (!tenant || !controller) return;
      tenant.controllers.delete(controller);
      if (tenant.controllers.size === 0) {
        clearInterval(tenant.heartbeat);
        this.tenants.delete(tenantId);
      }
    };
    const abort = () => {
      cleanup();
      try {
        controller?.close();
      } catch {}
    };
    const body = new ReadableStream<Uint8Array>({
      start: (streamController) => {
        controller = streamController;
        let tenant = this.tenants.get(tenantId);
        if (!tenant) {
          const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>();
          const heartbeat = setInterval(() => {
            const frame = encoder.encode(encodeHeartbeatFrame());
            for (const activeController of controllers) activeController.enqueue(frame);
          }, REALTIME_HEARTBEAT_INTERVAL);
          tenant = { controllers, heartbeat };
          this.tenants.set(tenantId, tenant);
        }
        tenant.controllers.add(streamController);
        streamController.enqueue(encoder.encode(encodeReadyFrame()));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      },
      cancel: cleanup,
    });
    return new Response(body, { headers: realtimeHeaders });
  };
}
