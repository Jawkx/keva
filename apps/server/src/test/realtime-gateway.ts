import { Effect } from "effect";
import { validateRealtimeEvent, type RealtimeGateway } from "../realtime.js";

export class TestRealtimeGateway implements RealtimeGateway {
  constructor(
    private readonly onPublish?: (
      tenantId: string,
      event: ReturnType<typeof validateRealtimeEvent>,
    ) => void,
  ) {}

  readonly publisher = {
    publish: (tenantId: string, value: unknown) =>
      Effect.sync(() => this.onPublish?.(tenantId, validateRealtimeEvent(value))),
  };

  readonly stream = async (): Promise<Response> =>
    new Response(null, { status: 501, statusText: "Not implemented by test gateway" });
}
