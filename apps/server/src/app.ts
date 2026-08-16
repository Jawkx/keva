import {
  BlobStore,
  ChangePublisherNoop,
  canDeleteOwnShareUpload,
  makeKevaEngine,
  MetadataStore,
  PROPERTY_SEARCH_LIMIT,
} from "@keva/core";
import {
  CreateAccountShare,
  BillingOverview,
  BILLING_PLANS,
  ChangeBillingPlan,
  Conflict,
  Forbidden,
  BatchPatch,
  ItemPatch,
  BatchDelete,
  BatchRestore,
  CreateShareGrant,
  CreateView,
  InitiateUpload,
  isFutureInstant,
  KevaError,
  MintToken,
  NotFound,
  Query,
  toSharedItem,
  toOwnerItem,
  toTrashItem,
  ThumbnailUploadInput,
  UpdateView,
  ValidationError,
  StorageUnavailable,
  type AvatarRecipe,
} from "@keva/schema";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { Hono, type Context } from "hono";
import {
  ApiTokenStore,
  requireAdminSession,
  requireStorageManagement,
  requireStoragePermissions,
} from "./auth.js";
import { mountMcp } from "./mcp.js";
import { ShareGrantStore } from "./shares.js";
import { ViewStore } from "./views.js";
import { BillingMeterLive } from "./billing.js";
import {
  decode,
  execute,
  failureFrom,
  itemIdParam,
  jsonBody,
  principalEffect,
  redactItem,
  reportDefect,
  reportServiceFailure,
  sessionUser,
} from "./http.js";
import type { AppServiceOptions, CreateAppOptions, KevaApp, RuntimeServices } from "./app-types.js";

export type {
  AppServiceOptions,
  AppServices,
  CreateAppOptions,
  KevaApp,
  RuntimeServices,
} from "./app-types.js";

interface ResolvedServices {
  readonly runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>;
  readonly authHandler?: (request: Request) => Response | Promise<Response>;
  readonly billing?: AppServiceOptions["billing"];
  readonly mcp?: AppServiceOptions["mcp"];
  readonly userAvatars?: AppServiceOptions["userAvatars"];
  readonly realtime?: AppServiceOptions["realtime"];
  readonly dispose?: () => Promise<void>;
}

const isRequestScoped = (
  options: CreateAppOptions,
): options is { readonly getRequestServices: (context: Context) => AppServiceOptions } =>
  "getRequestServices" in options;

const makeServices = (options: AppServiceOptions): ResolvedServices => ({
  runtime: ManagedRuntime.make(
    Layer.mergeAll(
      options.layer,
      BillingMeterLive(options.billing?.store),
      options.changePublisher ?? ChangePublisherNoop,
    ),
  ),
  ...(options.authHandler ? { authHandler: options.authHandler } : {}),
  ...(options.billing ? { billing: options.billing } : {}),
  ...(options.mcp ? { mcp: options.mcp } : {}),
  ...(options.userAvatars ? { userAvatars: options.userAvatars } : {}),
  ...(options.realtime ? { realtime: options.realtime } : {}),
  ...(options.dispose ? { dispose: options.dispose } : {}),
});

const disposeServices = (services: ResolvedServices) =>
  Effect.gen(function* () {
    const exits = yield* Effect.all([
      Effect.exit(Effect.tryPromise(() => services.runtime.dispose())),
      Effect.exit(Effect.tryPromise(() => services.dispose?.() ?? Promise.resolve())),
    ]);
    const failures = exits.filter(Exit.isFailure).map((exit) => Cause.squash(exit.cause));
    if (failures.length === 1) return yield* Effect.fail(failures[0]);
    if (failures.length > 1) {
      return yield* Effect.fail(new AggregateError(failures, "Failed to dispose server services"));
    }
  });

export const createApp = (options: CreateAppOptions): KevaApp => {
  const app = new Hono() as KevaApp;
  const getRequestServices = isRequestScoped(options) ? options.getRequestServices : undefined;
  const fixedServices = getRequestServices ? undefined : makeServices(options as AppServiceOptions);
  let disposePromise: Promise<void> | undefined;
  Object.defineProperty(app, "dispose", {
    value: () =>
      (disposePromise ??= fixedServices
        ? Effect.runPromise(disposeServices(fixedServices))
        : Promise.resolve()),
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
      if (!fixedServices) await Effect.runPromise(disposeServices(services));
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

  app.get("/api/events", (context) =>
    withServices(context, async ({ runtime, realtime }) => {
      if (!realtime) return context.notFound();
      const authorized = principalEffect(context.req.raw.headers).pipe(
        Effect.flatMap((principal) =>
          principal.via === "session"
            ? Effect.succeed(principal)
            : Effect.fail(new Forbidden({ message: "Session authentication required" })),
        ),
      );
      const exit = await runtime.runPromiseExit(authorized);
      if (Exit.isSuccess(exit)) {
        return realtime.stream(exit.value.tenantId, context.req.raw.signal);
      }
      reportDefect(context, exit.cause);
      const error = failureFrom(exit.cause);
      if (Option.isSome(Cause.findErrorOption(exit.cause))) reportServiceFailure(context, error);
      const status = error._tag === "Unauthorized" ? 401 : error._tag === "Forbidden" ? 403 : 503;
      return context.json(error, status);
    }),
  );

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
      if (Option.isSome(Cause.findErrorOption(ready.cause))) {
        reportServiceFailure(context, failureFrom(ready.cause));
      }
      return context.json({ ok: false, service: "keva" }, 503);
    }),
  );

  const runRoute = (context: Context, effect: Effect.Effect<unknown, KevaError, RuntimeServices>) =>
    withServices(context, ({ runtime }) => execute(context, effect, runtime));

  app.get("/api/billing", (context) =>
    withServices(context, ({ runtime, billing }) => {
      if (!billing) return context.notFound();
      return execute(
        context,
        Effect.gen(function* () {
          const principal = yield* principalEffect(context.req.raw.headers);
          const user = yield* sessionUser(principal);
          let overview = yield* Effect.tryPromise({
            try: () => billing.store.getOverview(principal.tenantId),
            catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
          }).pipe(Effect.flatMap((value) => decode(BillingOverview, value)));
          if (!overview.status.subscriptionId) return overview;
          const subscription = yield* Effect.promise(() =>
            billing.polar.subscriptions
              .get({ id: overview.status.subscriptionId! })
              .catch(() => null),
          );
          if (
            subscription &&
            overview.status.currentPeriodEnd &&
            new Date(overview.status.currentPeriodEnd) <= new Date()
          ) {
            yield* Effect.tryPromise({
              try: () =>
                billing.store.syncSubscription(
                  user.id,
                  principal.tenantId,
                  subscription,
                  new Date(),
                ),
              catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
            });
            overview = yield* Effect.tryPromise({
              try: () => billing.store.getOverview(principal.tenantId),
              catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
            }).pipe(Effect.flatMap((value) => decode(BillingOverview, value)));
          }
          if (overview.status.pendingPlan) return overview;
          const pending = subscription?.pendingUpdate;
          const plan = pending?.productId
            ? overview.plans.find((candidate) => candidate.productId === pending.productId)
            : undefined;
          if (!pending || !plan) return overview;
          const appliesAt = pending.appliesAt.toISOString();
          yield* Effect.tryPromise({
            try: () => billing.store.setPendingPlan(principal.tenantId, plan.slug, appliesAt),
            catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
          });
          return {
            ...overview,
            status: { ...overview.status, pendingPlan: plan.slug, pendingPlanAppliesAt: appliesAt },
          };
        }),
        runtime,
      );
    }),
  );

  app.post("/api/billing/plan", async (context) =>
    withServices(context, ({ runtime, billing }) => {
      if (!billing) return context.notFound();
      return execute(
        context,
        Effect.gen(function* () {
          const principal = yield* principalEffect(context.req.raw.headers);
          yield* sessionUser(principal);
          const input = yield* decode(ChangeBillingPlan, yield* jsonBody(context));
          const current = yield* Effect.tryPromise({
            try: () => billing.store.currentSubscription(principal.tenantId),
            catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
          });
          if (!current) return yield* new Conflict({ message: "No active subscription" });
          if (current.plan === input.plan) return { changed: false, effectiveAt: null };
          const plans = BILLING_PLANS;
          const currentIndex = plans.findIndex((plan) => plan.slug === current.plan);
          const nextIndex = plans.findIndex((plan) => plan.slug === input.plan);
          if (nextIndex < currentIndex) {
            const allowed = yield* Effect.tryPromise({
              try: () => billing.store.canDowngrade(principal.tenantId, input.plan),
              catch: () => new StorageUnavailable({ message: "Usage unavailable" }),
            });
            if (!allowed) {
              return yield* new Conflict({
                message: "Current storage or item usage exceeds the selected plan",
              });
            }
          }
          const overview = yield* Effect.tryPromise({
            try: () => billing.store.getOverview(principal.tenantId),
            catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
          });
          const productId = overview.plans.find((plan) => plan.slug === input.plan)?.productId;
          if (!productId) return yield* new ValidationError({ message: "Unknown billing plan" });
          const subscription = yield* Effect.tryPromise({
            try: () =>
              billing.polar.subscriptions.update({
                id: current.id,
                subscriptionUpdate: {
                  productId,
                  prorationBehavior: nextIndex > currentIndex ? "invoice" : "next_period",
                },
              }),
            catch: () => new StorageUnavailable({ message: "Could not update subscription" }),
          });
          const effectiveAt = subscription.pendingUpdate?.appliesAt.toISOString() ?? null;
          yield* Effect.tryPromise({
            try: () =>
              billing.store.setPendingPlan(
                principal.tenantId,
                effectiveAt ? input.plan : null,
                effectiveAt,
              ),
            catch: () => new StorageUnavailable({ message: "Could not save plan change" }),
          });
          return { changed: true, effectiveAt };
        }),
        runtime,
      );
    }),
  );

  app.delete("/api/billing/plan", (context) =>
    withServices(context, ({ runtime, billing }) => {
      if (!billing) return context.notFound();
      return execute(
        context,
        Effect.gen(function* () {
          const principal = yield* principalEffect(context.req.raw.headers);
          yield* sessionUser(principal);
          const current = yield* Effect.tryPromise({
            try: () => billing.store.currentSubscription(principal.tenantId),
            catch: () => new StorageUnavailable({ message: "Billing status unavailable" }),
          });
          if (!current) return yield* new Conflict({ message: "No active subscription" });
          yield* Effect.tryPromise({
            try: () =>
              billing.polar.subscriptions.update({
                id: current.id,
                subscriptionUpdate: { pendingUpdate: null },
              }),
            catch: () => new StorageUnavailable({ message: "Could not cancel plan change" }),
          });
          yield* Effect.tryPromise({
            try: () => billing.store.setPendingPlan(principal.tenantId, null, null),
            catch: () => new StorageUnavailable({ message: "Could not save plan change" }),
          });
          return { canceled: true };
        }),
        runtime,
      );
    }),
  );

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
        const result = yield* makeKevaEngine(principal).initiate(
          body,
          context.req.header("Retry-Key") ?? body.retryKey,
        );
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

  app.post("/api/items/:id/thumbnail", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        const input = yield* decode(ThumbnailUploadInput, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).initiateThumbnail(id, input);
      }),
    ),
  );

  app.get("/api/items/:id/thumbnail", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).downloadThumbnail(id);
      }),
    ),
  );

  app.delete("/api/items/:id/thumbnail", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        yield* makeKevaEngine(principal).deleteThumbnail(id);
        return { ok: true };
      }),
    ),
  );

  app.get("/api/items/:id/events", (context) =>
    withServices(context, ({ runtime, userAvatars }) =>
      execute(
        context,
        Effect.gen(function* () {
          const principal = yield* principalEffect(context.req.raw.headers);
          const id = yield* itemIdParam(context);
          const limitRaw = context.req.query("limit");
          const limit =
            limitRaw === undefined
              ? undefined
              : yield* decode(
                  Schema.NumberFromString.check(
                    Schema.isInt(),
                    Schema.isBetween({ minimum: 1, maximum: 200 }),
                  ),
                  limitRaw,
                );
          const cursor = context.req.query("cursor");
          const result = yield* makeKevaEngine(principal).events(id, {
            ...(limit !== undefined ? { limit } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          });
          if (!userAvatars) return result;
          const userIds = result.events.flatMap((event) =>
            event.actor?.user ? [event.actor.user.id] : [],
          );
          const avatars = yield* Effect.tryPromise({
            try: () => userAvatars(userIds),
            catch: () => new StorageUnavailable({ message: "User avatars unavailable" }),
          });
          return {
            ...result,
            events: result.events.map((event) => {
              const user = event.actor?.user;
              if (!user) return event;
              const avatar: AvatarRecipe = avatars.get(user.id) ?? { version: 1, seed: user.id };
              return { ...event, actor: { ...event.actor!, user: { ...user, avatar } } };
            }),
          };
        }),
        runtime,
      ),
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

  app.post("/api/items/patch", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const { items, set, unset } = yield* decode(BatchPatch, yield* jsonBody(context));
        return yield* makeKevaEngine(principal).patchMany(items, { set, unset });
      }),
    ),
  );

  app.get("/api/trash", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const items = yield* makeKevaEngine(principal).listTrash();
        return { items: items.map(toTrashItem) };
      }),
    ),
  );

  app.get("/api/trash/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return toTrashItem(yield* makeKevaEngine(principal).getTrash(id));
      }),
    ),
  );

  app.get("/api/trash/:id/content", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).downloadTrash(id);
      }),
    ),
  );

  app.get("/api/trash/:id/thumbnail", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(principal).downloadTrashThumbnail(id);
      }),
    ),
  );

  app.post("/api/trash/restore", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const { ids } = yield* decode(BatchRestore, yield* jsonBody(context));
        const engine = makeKevaEngine(principal);
        const results = yield* Effect.forEach(
          ids,
          (id) =>
            engine.restore(id).pipe(
              Effect.as({ id, error: undefined as string | undefined }),
              Effect.catch((error) => Effect.succeed({ id, error: error.message })),
            ),
          { concurrency: 8 },
        );
        return {
          restored: results.filter((result) => !result.error).map((result) => result.id),
          failed: results
            .filter((result) => result.error)
            .map((result) => ({ id: result.id, error: result.error! })),
        };
      }),
    ),
  );

  app.post("/api/trash/delete", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const { ids } = yield* decode(BatchDelete, yield* jsonBody(context));
        const engine = makeKevaEngine(principal);
        const results = yield* Effect.forEach(
          ids,
          (id) =>
            engine.purge(id).pipe(
              Effect.as({ id, error: undefined as string | undefined }),
              Effect.catch((error) => Effect.succeed({ id, error: error.message })),
            ),
          { concurrency: 8 },
        );
        return {
          deleted: results.filter((result) => !result.error).map((result) => result.id),
          failed: results
            .filter((result) => result.error)
            .map((result) => ({ id: result.id, error: result.error! })),
        };
      }),
    ),
  );

  app.post("/api/trash/:id/restore", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        return toOwnerItem(yield* makeKevaEngine(principal).restore(id));
      }),
    ),
  );

  app.delete("/api/trash/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        yield* makeKevaEngine(principal).purge(id);
        return { ok: true };
      }),
    ),
  );

  app.delete("/api/items/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const id = yield* itemIdParam(context);
        const engine = makeKevaEngine(principal);
        if (principal.via === "share") yield* engine.deleteOwnShareUpload(id);
        else yield* engine.delete(id);
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
              Effect.catch((error) => Effect.succeed({ id, error: error.message })),
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
              ? result.items.map((item) =>
                  toSharedItem(item, canDeleteOwnShareUpload(principal, item)),
                )
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

  app.get("/api/properties/search", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const principal = yield* principalEffect(context.req.raw.headers);
        const search = context.req.query("q")?.trim() ?? "";
        if (search.length < 2 || search.length > 256) {
          return yield* new ValidationError({
            message: "Property search must be between 2 and 256 characters",
          });
        }
        return yield* makeKevaEngine(principal).propertySuggestions(search, PROPERTY_SEARCH_LIMIT);
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
        const view = yield* shares.updateView(principal, context.req.param("id"), body);
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
        yield* requireStoragePermissions(principal, ["shares", ...body.scopes]);
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
          icon: access.received.icon,
          owner: access.received.owner,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
          allowOwnDelete: grant.allowOwnDelete,
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
        return {
          ...result,
          item: toSharedItem(result.item, canDeleteOwnShareUpload(access.principal, result.item)),
        };
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
        const item = yield* makeKevaEngine(access.principal).confirm(id);
        return toSharedItem(item, canDeleteOwnShareUpload(access.principal, item));
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
        const item = yield* makeKevaEngine(access.principal).get(id);
        return toSharedItem(item, canDeleteOwnShareUpload(access.principal, item));
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

  app.get("/api/shared-views/:grantId/items/:id/thumbnail", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const id = yield* itemIdParam(context);
        return yield* makeKevaEngine(access.principal).downloadThumbnail(id);
      }),
    ),
  );

  app.delete("/api/shared-views/:grantId/items/:id", (context) =>
    runRoute(
      context,
      Effect.gen(function* () {
        const access = yield* sharedViewAccess(
          context.req.raw.headers,
          context.req.param("grantId"),
        );
        const id = yield* itemIdParam(context);
        yield* makeKevaEngine(access.principal).deleteOwnShareUpload(id);
        return { ok: true };
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
        return {
          ...result,
          items: result.items.map((item) =>
            toSharedItem(item, canDeleteOwnShareUpload(access.principal, item)),
          ),
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
          allowOwnDelete: grant.allowOwnDelete,
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
