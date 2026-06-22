import {
  BlobStore,
  makeKevaEngine,
  MetadataStore,
  type BlobStoreService,
} from "@keva/core";
import {
  AttributePatch,
  InitiateUpload,
  Internal,
  KevaError,
  MintToken,
  Query,
  Unauthorized,
  ValidationError,
  statusFor,
} from "@keva/schema";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
} from "effect";
import { Hono, type Context } from "hono";
import {
  ApiTokenStore,
  Authenticator,
  requireAdminSession,
} from "./auth.js";

type AppServices = Authenticator | BlobStore | MetadataStore | ApiTokenStore;

const decode = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(() =>
      new ValidationError({ message: "Request validation failed" })
    ),
  );

const jsonBody = (context: Context) =>
  Effect.tryPromise({
    try: () => context.req.json() as Promise<unknown>,
    catch: () => new ValidationError({ message: "Request body must be JSON" }),
  });

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
}

export const createApp = ({ layer, authHandler }: CreateAppOptions): Hono => {
  const app = new Hono();
  const runtime = ManagedRuntime.make(layer);

  if (authHandler) {
    app.on(["GET", "POST"], "/api/auth/*", (context) =>
      authHandler(context.req.raw));
  }

  app.get("/health", (context) =>
    context.json({ ok: true, service: "keva" }));

  app.put("/__dev/blobs/*", async (context) => {
    const key = decodeURIComponent(context.req.path.slice("/__dev/blobs/".length));
    const token = context.req.query("token") ?? "";
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const contentType =
      context.req.header("content-type") ?? "application/octet-stream";
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

  app.post("/objects", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(InitiateUpload, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).initiate(body);
      }),
      runtime,
    ));

  app.post("/objects/:id/confirm", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).confirm(context.req.param("id"));
      }),
      runtime,
    ));

  app.get("/objects/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).get(context.req.param("id"));
      }),
      runtime,
    ));

  app.get("/objects/:id/content", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).download(context.req.param("id"));
      }),
      runtime,
    ));

  app.patch("/objects/:id/attributes", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(AttributePatch, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).patchAttributes(
          context.req.param("id"),
          body,
        );
      }),
      runtime,
    ));

  app.delete("/objects/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* makeKevaEngine(principal).delete(context.req.param("id"));
        return { ok: true };
      }),
      runtime,
    ));

  app.post("/query", async (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(Query, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).query(body);
      }),
      runtime,
    ));

  app.post("/tokens", async (context) =>
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
    ));

  app.get("/tokens", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return yield* tokens.list(principal.tenantId);
      }),
      runtime,
    ));

  app.delete("/tokens/:id", (context) =>
    execute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return {
          revoked: yield* tokens.revoke(
            principal.tenantId,
            context.req.param("id"),
          ),
        };
      }),
      runtime,
    ));

  return app;
};
