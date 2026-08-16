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

export interface DurableObjectStub {
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface DurableObjectNamespace {
  readonly idFromName: (name: string) => unknown;
  readonly get: (id: unknown) => DurableObjectStub;
}

export interface RealtimeExecutionContext {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

const encoder = new TextEncoder();

const internalRequest = (path: string, init?: RequestInit): Request =>
  new Request(`https://realtime.internal${path}`, init);

export const makeDurableObjectRealtimeGateway = (
  namespace: DurableObjectNamespace,
  executionContext: RealtimeExecutionContext,
): RealtimeGateway => ({
  publisher: {
    publish: (tenantId, event) =>
      Effect.sync(() => {
        const payload = validateRealtimeEvent(event);
        const stub = namespace.get(namespace.idFromName(tenantId));
        const publication = Effect.tryPromise({
          try: () =>
            stub.fetch(
              internalRequest("/publish", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
            ),
          catch: (cause) => new Error("Realtime publish request failed", { cause }),
        }).pipe(
          Effect.flatMap((response) =>
            response.ok
              ? Effect.void
              : Effect.fail(new Error(`Realtime publish failed: ${response.status}`)),
          ),
          Effect.catch((error) =>
            Effect.sync(() =>
              console.warn(
                JSON.stringify({
                  event: "realtime.publish.failed",
                  errorType: error.name,
                }),
              ),
            ),
          ),
        );
        executionContext.waitUntil(Effect.runPromise(publication));
      }),
  },
  stream: (tenantId, signal) => {
    const stub = namespace.get(namespace.idFromName(tenantId));
    return stub.fetch(internalRequest("/stream", { signal }));
  },
});

export class RealtimeHub {
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      try {
        const event = validateRealtimeEvent(await request.json());
        const frame = encoder.encode(encodeChangeFrame(event));
        for (const subscriber of this.subscribers) subscriber.enqueue(frame);
        return new Response(null, { status: 204 });
      } catch {
        return Response.json({ message: "Invalid realtime event" }, { status: 400 });
      }
    }
    if (request.method === "GET" && url.pathname === "/stream") {
      return this.openStream(request.signal);
    }
    return new Response("Not found", { status: 404 });
  }

  private openStream(signal: AbortSignal): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", abort);
      if (controller) this.subscribers.delete(controller);
      if (this.subscribers.size === 0 && this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = undefined;
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
        this.subscribers.add(streamController);
        streamController.enqueue(encoder.encode(encodeReadyFrame()));
        if (!this.heartbeat) {
          this.heartbeat = setInterval(() => {
            const frame = encoder.encode(encodeHeartbeatFrame());
            for (const subscriber of this.subscribers) subscriber.enqueue(frame);
          }, REALTIME_HEARTBEAT_INTERVAL);
        }
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      },
      cancel: cleanup,
    });
    return new Response(body, { headers: realtimeHeaders });
  }
}
