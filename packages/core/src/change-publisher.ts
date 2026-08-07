import type { RealtimeEvent } from "@keva/schema";
import { Context, Effect, Layer } from "effect";

export interface ChangePublisherService {
  readonly publish: (tenantId: string, event: RealtimeEvent) => Effect.Effect<void, never>;
}

export class ChangePublisher extends Context.Tag("@keva/core/ChangePublisher")<
  ChangePublisher,
  ChangePublisherService
>() {}

export const ChangePublisherNoop = Layer.succeed(ChangePublisher, {
  publish: () => Effect.void,
});
