import { BlobStore, DEFAULT_STORAGE_QUOTA_BYTES, makeKevaEngine, MetadataStore } from "@keva/core";
import {
  ItemPatch,
  BatchDelete,
  CreateShareGrant,
  CreateView,
  isPropertyKey,
  ItemId,
  InitiateUpload,
  Internal,
  KevaError,
  MintToken,
  NotFound,
  propertiesMatchCondition,
  Query,
  toSharedItem,
  Unauthorized,
  UpdateView,
  ValidationError,
  statusFor,
  type KevaItem,
  type Principal,
} from "@keva/schema";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { Hono, type Context } from "hono";
import { ApiTokenStore, Authenticator, requireAdminSession } from "./auth.js";
import type { AdminStore } from "./admin.js";
import { mountMcp, type McpDeps } from "./mcp.js";
import { ShareGrantStore } from "./shares.js";
import { ViewStore } from "./views.js";

export type AppServices =
  | Authenticator
  | BlobStore
  | MetadataStore
  | ApiTokenStore
  | ShareGrantStore
  | ViewStore;

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

// Share visitors never receive the tenant-internal storage fields. Redaction
// happens here at the boundary (not in the engine) so internal callers keep the
// full KevaItem shape and only the wire response is trimmed.
const redactItem = (principal: Principal, item: KevaItem) =>
  principal.via === "share" ? toSharedItem(item) : item;

export interface AppServiceOptions {
  readonly layer: Layer.Layer<AppServices>;
  readonly authHandler?: (request: Request) => Response | Promise<Response>;
  readonly admin?: { readonly token: string; readonly store: AdminStore };
  // Present only when Better Auth is configured (requires a database). Enables
  // the OAuth 2.1 discovery endpoints and the /mcp resource server. In the
  // no-DB/static-token path these routes stay unmounted, mirroring how token
  // management is unavailable without a database.
  readonly mcp?: McpDeps;
  readonly dispose?: () => Promise<void>;
}

export type CreateAppOptions =
  | AppServiceOptions
  | { readonly getRequestServices: (context: Context) => AppServiceOptions };

interface ResolvedServices {
  readonly runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;
  readonly authHandler?: (request: Request) => Response | Promise<Response>;
  readonly admin?: { readonly token: string; readonly store: AdminStore };
  readonly mcp?: McpDeps;
  readonly dispose?: () => Promise<void>;
}

const isRequestScoped = (
  options: CreateAppOptions,
): options is { readonly getRequestServices: (context: Context) => AppServiceOptions } =>
  "getRequestServices" in options;

const makeServices = (options: AppServiceOptions): ResolvedServices => ({
  runtime: ManagedRuntime.make(options.layer),
  ...(options.authHandler ? { authHandler: options.authHandler } : {}),
  ...(options.admin ? { admin: options.admin } : {}),
  ...(options.mcp ? { mcp: options.mcp } : {}),
  ...(options.dispose ? { dispose: options.dispose } : {}),
});

export const createApp = (options: CreateAppOptions): Hono => {
  const app = new Hono();
  const getRequestServices = isRequestScoped(options) ? options.getRequestServices : undefined;
  const fixedServices = getRequestServices ? undefined : makeServices(options as AppServiceOptions);
  const resolveServices = (context: Context): ResolvedServices =>
    fixedServices ?? makeServices(getRequestServices!(context));

  const withServices = async (
    context: Context,
    handler: (services: ResolvedServices) => Response | Promise<Response>,
  ): Promise<Response> => {
    const services = resolveServices(context);
    try {
      return await handler(services);
    } finally {
      if (!fixedServices) {
        await services.runtime.dispose();
        await services.dispose?.();
      }
    }
  };

  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    withServices(context, ({ authHandler }) =>
      authHandler ? authHandler(context.req.raw) : context.notFound(),
    ),
  );

  mountMcp(app, (context, handler) =>
    withServices(context, ({ mcp, runtime }) => (mcp ? handler(mcp, runtime) : context.notFound())),
  );

  app.get("/health", (context) => context.json({ ok: true, service: "keva" }));

  const withAdmin = (
    context: Context,
    handler: (admin: NonNullable<ResolvedServices["admin"]>) => Response | Promise<Response>,
  ) =>
    withServices(context, ({ admin }) => {
      if (!admin) return context.notFound();
      const authorization = context.req.header("authorization") ?? "";
      if (authorization !== `Bearer ${admin.token}`) {
        return context.json({ message: "Invalid admin token" }, 401);
      }
      return handler(admin);
    });

  app.get("/api/admin/users", (context) =>
    withAdmin(context, async ({ store }) =>
      context.json({ users: await store.listUsers(context.req.query("search") ?? "") }),
    ),
  );

  app.put("/api/admin/users/:id/quota", async (context) =>
    withAdmin(context, async ({ store }) => {
      const body = (await context.req.json().catch(() => null)) as {
        quotaBytes?: unknown;
        useDefault?: unknown;
      } | null;
      const requestedQuota =
        body?.useDefault === true ? DEFAULT_STORAGE_QUOTA_BYTES : body?.quotaBytes;
      if (
        requestedQuota !== null &&
        (typeof requestedQuota !== "number" ||
          !Number.isSafeInteger(requestedQuota) ||
          requestedQuota < -1)
      ) {
        return context.json({ message: "quotaBytes must be an integer, null, 0, or -1" }, 400);
      }
      const quotaBytes =
        requestedQuota === null || requestedQuota === 0 || requestedQuota === -1
          ? null
          : requestedQuota;
      const user = await store.setQuota(context.req.param("id"), quotaBytes);
      return user
        ? context.json({ user })
        : context.json({ message: "User has no storage account" }, 404);
    }),
  );

  app.put("/__dev/blobs/*", async (context) => {
    const key = decodeURIComponent(context.req.path.slice("/__dev/blobs/".length));
    const token = context.req.query("token") ?? "";
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const contentType = context.req.header("content-type") ?? "application/octet-stream";
    return withServices(context, ({ runtime }) =>
      execute(
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
      ),
    );
  });

  app.get("/__dev/blobs/*", async (context) => {
    const key = decodeURIComponent(context.req.path.slice("/__dev/blobs/".length));
    const token = context.req.query("token") ?? "";
    return withServices(context, async ({ runtime }) => {
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
  });

  const runRoute = (context: Context, effect: Effect.Effect<unknown, KevaError, AppServices>) =>
    withServices(context, ({ runtime }) => execute(context, effect, runtime));

  // Data routes live under /api so they never collide with the web app's
  // client-side routes (/items/:id, /query, /tokens), which share these
  // names. Auth (/api/auth/*) is already prefixed; /health and /__dev stay at
  // the root for load balancers and the dev blob shim.
  app.post("/api/items", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(InitiateUpload, yield* jsonBody(context));
        const result = yield* makeKevaEngine(principal).initiate(body);
        return { ...result, item: redactItem(principal, result.item) };
      }),
    ),
  );

  app.post("/api/items/:id/confirm", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return redactItem(principal, yield* makeKevaEngine(principal).confirm(id));
      }),
    ),
  );

  app.get("/api/items/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return redactItem(principal, yield* makeKevaEngine(principal).get(id));
      }),
    ),
  );

  app.get("/api/items/:id/content", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).download(id);
      }),
    ),
  );

  app.get("/api/items/:id/events", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        const limitRaw = context.req.query("limit");
        const limit =
          limitRaw === undefined
            ? undefined
            : yield* decode(
                Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 200)),
                limitRaw,
              );
        const cursor = context.req.query("cursor");
        return yield* makeKevaEngine(principal).events(id, {
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        });
      }),
    ),
  );

  app.patch("/api/items/:id", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        const body = yield* decode(ItemPatch, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).patch(id, body);
      }),
    ),
  );

  app.delete("/api/items/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        yield* makeKevaEngine(principal).delete(id);
        return { ok: true };
      }),
    ),
  );

  // Batch delete: fan out over the idempotent per-id delete, isolating each so
  // one failure (missing blob, transient store error) doesn't sink the rest.
  app.post("/api/items/delete", (context) =>
    runRoute(
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
    ),
  );

  app.post("/api/query", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const body = yield* decode(Query, yield* jsonBody(context));
        const result = yield* makeKevaEngine(principal).query(body);
        return principal.via === "share"
          ? { ...result, items: result.items.map(toSharedItem) }
          : result;
      }),
    ),
  );

  app.get("/api/usage", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).usage();
      }),
    ),
  );

  app.get("/api/properties/keys", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).propertyKeys();
      }),
    ),
  );

  app.get("/api/properties/summary", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        return yield* makeKevaEngine(principal).propertySummary();
      }),
    ),
  );

  app.get("/api/properties/values", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const key = context.req.query("key");
        if (!key) {
          return yield* new ValidationError({ message: "Missing 'key' query parameter" });
        }
        return yield* makeKevaEngine(principal).propertyValues(key);
      }),
    ),
  );

  app.post("/api/tokens", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const body = yield* decode(MintToken, yield* jsonBody(context));
        const tokens = yield* ApiTokenStore;
        return yield* tokens.mint(principal.tenantId, body);
      }),
    ),
  );

  app.get("/api/tokens", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return yield* tokens.list(principal.tenantId);
      }),
    ),
  );

  app.delete("/api/tokens/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const tokens = yield* ApiTokenStore;
        return {
          revoked: yield* tokens.revoke(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  app.post("/api/views", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const body = yield* decode(CreateView, yield* jsonBody(context));
        const views = yield* ViewStore;
        return yield* views.create(principal.tenantId, body);
      }),
    ),
  );

  app.get("/api/views", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const views = yield* ViewStore;
        return yield* views.list(principal.tenantId);
      }),
    ),
  );

  app.get("/api/views/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const views = yield* ViewStore;
        const view = yield* views.get(principal.tenantId, context.req.param("id"));
        if (!view) return yield* new NotFound({ message: "View not found" });
        return view;
      }),
    ),
  );

  app.patch("/api/views/:id", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const body = yield* decode(UpdateView, yield* jsonBody(context));
        const views = yield* ViewStore;
        const view = yield* views.update(principal.tenantId, context.req.param("id"), body);
        if (!view) return yield* new NotFound({ message: "View not found" });
        return view;
      }),
    ),
  );

  app.delete("/api/views/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const views = yield* ViewStore;
        return {
          deleted: yield* views.delete(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  // Write-soundness invariants that depend on the
  // view's conditions are enforced here (the CreateShareGrant schema can only
  // check the writeStamp-presence invariant, since conditions live on the view).
  app.post("/api/shares", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const body = yield* decode(CreateShareGrant, yield* jsonBody(context));
        const views = yield* ViewStore;
        const view = yield* views.get(principal.tenantId, body.viewId);
        if (!view) return yield* new NotFound({ message: "View not found" });
        if (body.scopes.includes("write")) {
          if (!view.conditions.every((c) => isPropertyKey(c.key))) {
            return yield* new ValidationError({
              message: "Write grants may only condition on plain property keys",
            });
          }
          if (
            body.writeStamp !== undefined &&
            !view.conditions.every((c) => propertiesMatchCondition(body.writeStamp!, c))
          ) {
            return yield* new ValidationError({
              message: "writeStamp must satisfy every view condition",
            });
          }
        }
        const shares = yield* ShareGrantStore;
        return yield* shares.create(principal.tenantId, body);
      }),
    ),
  );

  app.get("/api/shares", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const shares = yield* ShareGrantStore;
        return yield* shares.list(principal.tenantId);
      }),
    ),
  );

  app.delete("/api/shares/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const shares = yield* ShareGrantStore;
        return {
          revoked: yield* shares.revoke(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  // Deliberately withhold conditions and write stamps: they may encode private tenant taxonomy.
  app.get("/api/shares/self", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const share = principal.via === "share" ? principal.share : undefined;
        if (!share) {
          return yield* new NotFound({ message: "Not a share" });
        }
        const shares = yield* ShareGrantStore;
        // Re-read the grant so a mid-session revocation surfaces (the resolved
        // principal is a snapshot from token-resolution time).
        const grant = yield* shares.get(principal.tenantId, share.grantId);
        if (!grant) {
          return yield* new NotFound({ message: "Share not found" });
        }
        const canWrite = grant.scopes.includes("write");
        const metadata = yield* MetadataStore;
        const used = canWrite
          ? yield* metadata.sourceUsage(principal.tenantId, `share:${grant.id}`)
          : { count: 0, bytes: 0 };
        return {
          name: grant.name,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
          upload: canWrite
            ? {
                maxItemBytes: grant.maxItemBytes,
                maxTotalBytes: grant.maxTotalBytes,
                maxItems: grant.maxItems,
                usedBytes: used.bytes,
                usedItems: used.count,
              }
            : null,
        };
      }),
    ),
  );

  return app;
};
