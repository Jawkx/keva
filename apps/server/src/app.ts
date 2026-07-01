import { BlobStore, makeKevaEngine, MetadataStore } from "@keva/core";
import {
  ItemPatch,
  BatchDelete,
  ItemId,
  InitiateUpload,
  Internal,
  KevaError,
  MintToken,
  Query,
  Unauthorized,
  ValidationError,
  statusFor,
} from "@keva/schema";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { Hono, type Context } from "hono";
import { ApiTokenStore, Authenticator, requireAdminSession } from "./auth.js";
import { mountMcp, type McpDeps } from "./mcp.js";

export type AppServices = Authenticator | BlobStore | MetadataStore | ApiTokenStore;

const decode = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(() => new ValidationError({ message: "Request validation failed" })),
  );

const jsonBody = (context: Context) =>
  Effect.tryPromise({
    try: () => context.req.json() as Promise<unknown>,
    catch: () => new ValidationError({ message: "Request body must be JSON" }),
  });

const itemIdParam = (context: Context) => decode(ItemId, context.req.param("id"));

// Every route's failure channel is a typed KevaError, so a tracked failure maps
// straight to its tagged error. Only an untracked defect (Effect.die, a thrown
// bug) falls through to a generic 500 — internals are never serialized.
const failureFrom = (cause: Cause.Cause<KevaError>): KevaError =>
  Option.getOrElse(
    Cause.failureOption(cause),
    () => new Internal({ message: "Internal server error" }),
  );

const execute = async <A>(
  context: Context,
  effect: Effect.Effect<A, KevaError, AppServices>,
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): Promise<Response> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return context.json(exit.value as never);
  const error = failureFrom(exit.cause);
  return context.json(error, statusFor(error) as never);
};

const principalEffect = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;
    return yield* authenticator.authenticate({ headers });
  });

export interface CreateAppOptions {
  readonly layer: Layer.Layer<AppServices>;
  readonly authHandler?: (request: Request) => Response | Promise<Response>;
  // Present only when Better Auth is configured (requires a database). Enables
  // the OAuth 2.1 discovery endpoints and the /mcp resource server. In the
  // no-DB/static-token path these routes stay unmounted, mirroring how token
  // management is unavailable without a database.
  readonly mcp?: McpDeps;
}

export const createApp = ({ layer, authHandler, mcp }: CreateAppOptions): Hono => {
  const app = new Hono();
  const runtime = ManagedRuntime.make(layer);

  if (authHandler) {
    app.on(["GET", "POST"], "/api/auth/*", (context) => authHandler(context.req.raw));
  }

  if (mcp) {
    mountMcp(app, mcp, runtime);
  }

  app.get("/health", (context) => context.json({ ok: true, service: "keva" }));

  app.put("/__dev/blobs/*", async (context) => {
    const key = decodeURIComponent(context.req.path.slice("/__dev/blobs/".length));
    const token = context.req.query("token") ?? "";
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const contentType = context.req.header("content-type") ?? "application/octet-stream";
    return execute(
      context,
      Effect.gen(function* () {
        const blobs = yield* BlobStore;
        if (!blobs.devPut) {
          return yield* new Unauthorized({ message: "Dev blob route disabled" });
        }
        yield* blobs.devPut(key, bytes, contentType, token);
        return { ok: true };
      }),
      runtime,
    );
  });

  app.get("/__dev/blobs/*", async (context) => {
    const key = decodeURIComponent(context.req.path.slice("/__dev/blobs/".length));
    const token = context.req.query("token") ?? "";
    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const blobs = yield* BlobStore;
        if (!blobs.devGet) {
          return yield* new Unauthorized({ message: "Dev blob route disabled" });
        }
        return yield* blobs.devGet(key, token);
      }),
    );
    if (Exit.isFailure(exit)) {
      const error = failureFrom(exit.cause);
      return context.json(error, statusFor(error) as never);
    }
    if (!exit.value) return context.notFound();
    return new Response(exit.value.bytes.slice().buffer as ArrayBuffer, {
      headers: { "content-type": exit.value.contentType },
    });
  });

  // Data routes live under /api so they never collide with the web app's
  // client-side routes (/items/:id, /query, /tokens), which share these
  // names. Auth (/api/auth/*) is already prefixed; /health and /__dev stay at
  // the root for load balancers and the dev blob shim.
  app.post("/api/items", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(InitiateUpload, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).initiate(body);
      }),
      runtime,
    ),
  );

  app.post("/api/items/:id/confirm", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).confirm(id);
      }),
      runtime,
    ),
  );

  app.get("/api/items/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).get(id);
      }),
      runtime,
    ),
  );

  app.get("/api/items/:id/content", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).download(id);
      }),
      runtime,
    ),
  );

  app.patch("/api/items/:id", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        const body = yield* decode(ItemPatch, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).patch(id, body);
      }),
      runtime,
    ),
  );

  app.delete("/api/items/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        yield* makeKevaEngine(principal).delete(id);
        return { ok: true };
      }),
      runtime,
    ),
  );

  // Batch delete: fan out over the idempotent per-id delete, isolating each so
  // one failure (missing blob, transient store error) doesn't sink the rest.
  app.post("/api/items/delete", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const { ids } = yield* decode(BatchDelete, yield* jsonBody(context));
        const engine = makeKevaEngine(principal);
        const results = yield* Effect.forEach(
          ids,
          (id) =>
            engine.delete(id).pipe(
              Effect.as({ id, error: undefined as string | undefined }),
              Effect.catchAll((error) => Effect.succeed({ id, error: error.message })),
            ),
          { concurrency: 8 },
        );
        return {
          deleted: results.filter((r) => !r.error).map((r) => r.id),
          failed: results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error! })),
        };
      }),
      runtime,
    ),
  );

  app.post("/api/query", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(Query, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).query(body);
      }),
      runtime,
    ),
  );

  app.post("/api/tokens", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const body = yield* decode(MintToken, yield* jsonBody(context));
        const tokens = yield* ApiTokenStore;
        return yield* tokens.mint(principal.tenantId, body);
      }),
      runtime,
    ),
  );

  app.get("/api/tokens", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return yield* tokens.list(principal.tenantId);
      }),
      runtime,
    ),
  );

  app.delete("/api/tokens/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return {
          revoked: yield* tokens.revoke(principal.tenantId, context.req.param("id")),
        };
      }),
      runtime,
    ),
  );

  return app;
};
