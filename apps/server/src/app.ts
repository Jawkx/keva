import { BlobStore, DEFAULT_STORAGE_QUOTA_BYTES, makeKevaEngine, MetadataStore } from "@keva/core";
import {
  CreateAccountShare,
  ItemPatch,
  UpdateAdminQuota,
  BatchDelete,
  CreateShareGrant,
  CreateView,
  ItemId,
  InitiateUpload,
  isFutureInstant,
  Internal,
  KevaError,
  MintToken,
  NotFound,
  Query,
  toSharedItem,
  toOwnerItem,
  UpdateView,
  ValidationError,
  statusFor,
  type KevaItem,
  type Principal,
} from "@keva/schema";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { Hono, type Context } from "hono";
import {
  ApiTokenStore,
  Authenticator,
  requireAdminSession,
  requireStorageManagement,
} from "./auth.js";
import type { AdminStore } from "./admin.js";
import { defectTypes, failureOrElse } from "./effect-failure.js";
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
  failureOrElse(cause, () => new Internal({ message: "Internal server error" }));

const reportDefect = (context: Context, cause: Cause.Cause<unknown>): void => {
  if (Option.isSome(Cause.failureOption(cause))) return;
  console.error(
    JSON.stringify({
      event: "http.request.defect",
      method: context.req.method,
      path: context.req.path,
      defectTypes: defectTypes(cause),
    }),
  );
};

const reportServiceFailure = (context: Context, error: KevaError): void => {
  if (statusFor(error) < 500) return;
  console.error(
    JSON.stringify({
      event: "http.request.failed",
      method: context.req.method,
      path: context.req.path,
      errorTag: error._tag,
    }),
  );
};

const execute = async <A>(
  context: Context,
  effect: Effect.Effect<A, KevaError, AppServices>,
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): Promise<Response> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return context.json(exit.value as never);
  reportDefect(context, exit.cause);
  const error = failureFrom(exit.cause);
  if (Option.isSome(Cause.failureOption(exit.cause))) reportServiceFailure(context, error);
  return context.json(error, statusFor(error) as never);
};

const principalEffect = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;
    return yield* authenticator.authenticate({ headers });
  });

const sessionUser = (principal: Principal) =>
  principal.via === "session" && principal.actor?.user
    ? Effect.succeed(principal.actor.user)
    : Effect.fail(new NotFound({ message: "Account session not found" }));

// Share visitors never receive the tenant-internal storage fields. Redaction
// happens here at the boundary (not in the engine) so internal callers keep the
// full KevaItem shape and only the wire response is trimmed.
const redactItem = (principal: Principal, item: KevaItem) =>
  principal.via === "share" ? toSharedItem(item) : toOwnerItem(item);

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

export type KevaApp = Hono & { readonly dispose: () => Promise<void> };

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

const disposeServices = async (services: ResolvedServices): Promise<void> => {
  const failures: unknown[] = [];
  try {
    await services.runtime.dispose();
  } catch (error) {
    failures.push(error);
  }
  try {
    await services.dispose?.();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Failed to dispose server services");
  }
};

export const createApp = (options: CreateAppOptions): KevaApp => {
  const app = new Hono() as KevaApp;
  const getRequestServices = isRequestScoped(options) ? options.getRequestServices : undefined;
  const fixedServices = getRequestServices ? undefined : makeServices(options as AppServiceOptions);
  let disposePromise: Promise<void> | undefined;
  Object.defineProperty(app, "dispose", {
    value: () =>
      (disposePromise ??= fixedServices ? disposeServices(fixedServices) : Promise.resolve()),
  });
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
      if (!fixedServices) await disposeServices(services);
    }
  };

  app.all("/api/auth/organization/*", (context) =>
    context.json({ _tag: "Forbidden", message: "Organization management is not available" }, 403),
  );

  app.all("/api/auth/*", (context) =>
    withServices(context, ({ authHandler }) =>
      authHandler ? authHandler(context.req.raw) : context.notFound(),
    ),
  );

  mountMcp(app, (context, handler) =>
    withServices(context, ({ mcp, runtime }) => (mcp ? handler(mcp, runtime) : context.notFound())),
  );

  app.get("/health", (context) => context.json({ ok: true, service: "keva" }));

  app.get("/ready", (context) =>
    withServices(context, async ({ runtime }) => {
      const ready = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const metadata = yield* MetadataStore;
          const blobs = yield* BlobStore;
          yield* metadata.usage("__keva_readiness__");
          yield* blobs.head("__keva_readiness__");
        }),
      );
      if (Exit.isSuccess(ready)) return context.json({ ok: true, service: "keva" });
      reportDefect(context, ready.cause);
      if (Option.isSome(Cause.failureOption(ready.cause))) {
        reportServiceFailure(context, failureFrom(ready.cause));
      }
      return context.json({ ok: false, service: "keva" }, 503);
    }),
  );

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
      const body = await context.req.json().catch(() => null);
      const decoded = Schema.decodeUnknownEither(UpdateAdminQuota)(body);
      if (decoded._tag === "Left") return context.json({ message: "Invalid quota update" }, 400);
      const requestedQuota =
        "useDefault" in decoded.right ? DEFAULT_STORAGE_QUOTA_BYTES : decoded.right.quotaBytes;
      // null and -1 are the unlimited sentinels; a non-negative value is a real
      // byte cap (0 blocks all uploads). Do not fold 0 into unlimited.
      const quotaBytes = requestedQuota === null || requestedQuota === -1 ? null : requestedQuota;
      const user = await store.setQuota(context.req.param("id"), quotaBytes);
      return user
        ? context.json({ user })
        : context.json({ message: "User has no storage account" }, 404);
    }),
  );

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
        return {
          ...result,
          item: redactItem(principal, result.item),
        };
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
        return redactItem(principal, yield* makeKevaEngine(principal).patch(id, body));
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
        return {
          ...result,
          items:
            principal.via === "share"
              ? result.items.map(toSharedItem)
              : result.items.map(toOwnerItem),
        };
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
        if (body.expiresAt && !isFutureInstant(body.expiresAt)) {
          return yield* new ValidationError({ message: "Token expiration must be in the future" });
        }
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
        yield* requireStorageManagement(principal, "views");
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
        yield* requireStorageManagement(principal, "views");
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
        yield* requireStorageManagement(principal, "views");
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
        yield* requireStorageManagement(principal, "views");
        const body = yield* decode(UpdateView, yield* jsonBody(context));
        const shares = yield* ShareGrantStore;
        const view = yield* shares.updateView(principal.tenantId, context.req.param("id"), body);
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
        yield* requireStorageManagement(principal, "views");
        const views = yield* ViewStore;
        return {
          deleted: yield* views.delete(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  app.post("/api/shares", async (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireStorageManagement(principal, "shares");
        const body = yield* decode(CreateShareGrant, yield* jsonBody(context));
        if (body.expiresAt && !isFutureInstant(body.expiresAt)) {
          return yield* new ValidationError({ message: "Share expiration must be in the future" });
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
        yield* requireStorageManagement(principal, "shares");
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
        yield* requireStorageManagement(principal, "shares");
        const shares = yield* ShareGrantStore;
        return {
          revoked: yield* shares.revoke(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  app.post("/api/account-shares", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        const owner = yield* sessionUser(principal);
        const body = yield* decode(CreateAccountShare, yield* jsonBody(context));
        if (body.expiresAt && !isFutureInstant(body.expiresAt)) {
          return yield* new ValidationError({ message: "Share expiration must be in the future" });
        }
        const shares = yield* ShareGrantStore;
        return yield* shares.createAccount(principal.tenantId, owner.id, body);
      }),
    ),
  );

  app.get("/api/account-shares", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        return yield* shares.listAccountOwned(principal.tenantId);
      }),
    ),
  );

  app.delete("/api/account-shares/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        yield* requireAdminSession(principal);
        yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        return {
          revoked: yield* shares.revokeAccount(principal.tenantId, context.req.param("id")),
        };
      }),
    ),
  );

  app.get("/api/shared-views", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const user = yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        return yield* shares.listReceived(user.id);
      }),
    ),
  );

  app.post("/api/shared-views/:grantId/accept", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const user = yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        const accepted = yield* shares.acceptAccount(user.id, context.req.param("grantId"));
        if (!accepted) return yield* new NotFound({ message: "Invitation not found" });
        return accepted;
      }),
    ),
  );

  app.post("/api/shared-views/:grantId/decline", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const user = yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        return { declined: yield* shares.declineAccount(user.id, context.req.param("grantId")) };
      }),
    ),
  );

  app.delete("/api/shared-views/:grantId", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const user = yield* sessionUser(principal);
        const shares = yield* ShareGrantStore;
        return { left: yield* shares.leaveAccount(user.id, context.req.param("grantId")) };
      }),
    ),
  );

  const sharedViewAccess = (headers: Headers, grantId: string) =>
    Effect.gen(function* () {
      const principal = yield* principalEffect(headers);
      const user = yield* sessionUser(principal);
      const shares = yield* ShareGrantStore;
      const access = yield* shares.accessAccount(user, grantId);
      if (!access) return yield* new NotFound({ message: "Shared view not found" });
      return access;
    });

  app.get("/api/shared-views/:grantId/self", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const grant = access.grant;
        const canWrite = grant.scopes.includes("write");
        const metadata = yield* MetadataStore;
        const used = canWrite
          ? yield* metadata.sourceUsage(access.principal.tenantId, `share:${grant.id}`)
          : { count: 0, bytes: 0 };
        return {
          name: access.received.name,
          owner: access.received.owner,
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

  app.post("/api/shared-views/:grantId/items", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const body = yield* decode(InitiateUpload, yield* jsonBody(context));
        const result = yield* makeKevaEngine(access.principal).initiate(body);
        return { ...result, item: toSharedItem(result.item) };
      }),
    ),
  );

  app.post("/api/shared-views/:grantId/items/:id/confirm", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const id = yield* itemIdParam(context);
        return toSharedItem(yield* makeKevaEngine(access.principal).confirm(id));
      }),
    ),
  );

  app.get("/api/shared-views/:grantId/items/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const id = yield* itemIdParam(context);
        return toSharedItem(yield* makeKevaEngine(access.principal).get(id));
      }),
    ),
  );

  app.get("/api/shared-views/:grantId/items/:id/content", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(access.principal).download(id);
      }),
    ),
  );

  app.post("/api/shared-views/:grantId/query", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const body = yield* decode(Query, yield* jsonBody(context));
        const result = yield* makeKevaEngine(access.principal).query(body);
        return { ...result, items: result.items.map(toSharedItem) };
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
