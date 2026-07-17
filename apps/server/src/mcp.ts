import { makeKevaEngine } from "@keva/core";
import { ClientSafeToolError, createKevaMcpServer, type McpEngine } from "@keva/mcp";
import {
  ItemId,
  ItemPatch,
  ItemEventsResult,
  InitiateUpload,
  OwnerInitiateUploadResult,
  OwnerItem,
  OwnerQueryResult,
  PropertySummaryResult,
  BatchDeleteResult,
  CreateView,
  UpdateView,
  ViewRecord,
  CreateShareGrant,
  CreateShareGrantResult,
  ShareGrantRecord,
  DownloadResult,
  PropertyKeysResult,
  PropertyValuesResult,
  Query,
  UsageResult,
  Internal,
  NotFound,
  StorageUnavailable,
  ValidationError,
  isFutureInstant,
  toOwnerItem,
  type KevaError,
  type Principal,
} from "@keva/schema";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, ManagedRuntime, Option, Schema } from "effect";
import type { Hono } from "hono";
import type { Context } from "hono";
import type { AppServices } from "./app.js";
import { mcpScopesToKevaScopes } from "./auth.js";
import type { ConnectionStore, McpActorNames, McpAuthorizationServer } from "./better-auth.js";
import { defectTypes, failureOrElse } from "./effect-failure.js";
import { ShareGrantStore } from "./shares.js";
import { ViewStore } from "./views.js";

type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

export interface McpAccessToken {
  readonly userId: string;
  readonly scopes: string;
  readonly clientId: string;
}

export interface McpDeps {
  readonly authorizationServer: McpAuthorizationServer;
  readonly resolveTenant: (userId: string) => Promise<string | null>;
  readonly resolveActorNames: (userId: string, clientId: string) => Promise<McpActorNames>;
  readonly connections: ConnectionStore;
}

export const principalFromMcpToken = (
  token: McpAccessToken,
  tenantId: string,
  names: McpActorNames,
): Principal => ({
  tenantId,
  scopes: mcpScopesToKevaScopes(token.scopes),
  via: "token",
  actor: {
    user: { id: token.userId, name: names.userName ?? token.userId },
    agent: { clientId: token.clientId, name: names.clientName ?? token.clientId },
  },
});

const decode = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(() => new ValidationError({ message: "Tool input validation failed" })),
  );

const runEngine = async <A>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, KevaError, AppServices>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  if (Option.isNone(Cause.failureOption(exit.cause))) {
    console.error(
      JSON.stringify({ event: "mcp.engine.defect", defectTypes: defectTypes(exit.cause) }),
    );
  }
  const error = failureOrElse(exit.cause, () => new Internal({ message: "Internal server error" }));
  throw new ClientSafeToolError(error.message);
};

const runValidated = <A, I>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, KevaError, AppServices>,
  schema: Schema.Schema<A, I, never>,
): Promise<A> =>
  runEngine(
    runtime,
    effect.pipe(
      Effect.flatMap((value) =>
        Schema.decodeUnknown(schema)(value).pipe(
          Effect.mapError(() => new Internal({ message: "Invalid engine response" })),
        ),
      ),
    ),
  );

const makeMcpEngine = (principal: Principal, runtime: AppRuntime): McpEngine => {
  const engine = makeKevaEngine(principal);
  return {
    queryItems: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const query = yield* decode(Query, input);
          const result = yield* engine.query(query);
          return { ...result, items: result.items.map(toOwnerItem) };
        }),
        OwnerQueryResult,
      ),
    getItem: (id) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return toOwnerItem(yield* engine.get(itemId));
        }),
        OwnerItem,
      ),
    getContentUrl: (id) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return yield* engine.download(itemId);
        }),
        DownloadResult,
      ),
    getItemEvents: ({ id, limit, cursor }) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return yield* engine.events(itemId, {
            ...(limit !== undefined ? { limit } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          });
        }),
        ItemEventsResult,
      ),
    getUsage: () => runValidated(runtime, engine.usage(), UsageResult),
    listPropertyKeys: () => runValidated(runtime, engine.propertyKeys(), PropertyKeysResult),
    listPropertyValues: ({ key }) =>
      runValidated(runtime, engine.propertyValues(key), PropertyValuesResult),
    getPropertySummary: () =>
      runValidated(runtime, engine.propertySummary(), PropertySummaryResult),
    beginUpload: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const upload = yield* decode(InitiateUpload, input);
          const result = yield* engine.initiate(upload);
          return { ...result, item: toOwnerItem(result.item) };
        }),
        OwnerInitiateUploadResult,
      ),
    completeUpload: (id) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return toOwnerItem(yield* engine.confirm(itemId));
        }),
        OwnerItem,
      ),
    uploadContent: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const bytes = yield* Effect.try({
            try: () =>
              input.encoding === "base64"
                ? Uint8Array.from(atob(input.content), (character) => character.charCodeAt(0))
                : new TextEncoder().encode(input.content),
            catch: () => new ValidationError({ message: "Content is not valid base64" }),
          });
          if (bytes.byteLength > 1024 * 1024) {
            return yield* new ValidationError({
              message: "Inline MCP uploads are limited to 1 MiB",
            });
          }
          const result = yield* engine.initiate({
            name: input.name,
            contentType: input.contentType,
            size: bytes.byteLength,
            source: input.source,
            properties: input.properties,
          });
          yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(result.uploadUrl, {
                method: "PUT",
                headers: result.headers,
                body: bytes,
                signal,
              });
              if (!response.ok) throw new Error(`Blob upload failed with ${response.status}`);
            },
            catch: () => new StorageUnavailable({ message: "Blob upload failed" }),
          }).pipe(
            Effect.timeoutFail({
              duration: 30_000,
              onTimeout: () => new StorageUnavailable({ message: "Blob upload failed" }),
            }),
          );
          return toOwnerItem(yield* engine.confirm(result.item.id));
        }),
        OwnerItem,
      ),
    setProperties: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, input.id);
          const patch = yield* decode(ItemPatch, {
            ...(input.set !== undefined ? { set: input.set } : {}),
            ...(input.unset !== undefined ? { unset: input.unset } : {}),
          });
          return toOwnerItem(yield* engine.patch(itemId, patch));
        }),
        OwnerItem,
      ),
    deleteItem: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          yield* engine.delete(itemId);
        }),
      ),
    deleteItems: (ids) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemIds = yield* Effect.forEach(ids, (id) => decode(ItemId, id));
          const results = yield* Effect.forEach(
            itemIds,
            (id) =>
              engine.delete(id).pipe(
                Effect.as({ id, error: undefined as string | undefined }),
                Effect.catchAll((error) => Effect.succeed({ id, error: error.message })),
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
        BatchDeleteResult,
      ),
    createView: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const body = yield* decode(CreateView, input);
          const views = yield* ViewStore;
          return yield* views.create(principal.tenantId, body);
        }),
        ViewRecord,
      ),
    listViews: () =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const views = yield* ViewStore;
          return yield* views.list(principal.tenantId);
        }),
        Schema.Array(ViewRecord),
      ),
    getView: (id) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const views = yield* ViewStore;
          const view = yield* views.get(principal.tenantId, id);
          if (!view) return yield* new NotFound({ message: "View not found" });
          return view;
        }),
        ViewRecord,
      ),
    updateView: (id, input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const body = yield* decode(UpdateView, input);
          const shares = yield* ShareGrantStore;
          const view = yield* shares.updateView(principal.tenantId, id, body);
          if (!view) return yield* new NotFound({ message: "View not found" });
          return view;
        }),
        ViewRecord,
      ),
    deleteView: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const views = yield* ViewStore;
          return { deleted: yield* views.delete(principal.tenantId, id) };
        }),
      ),
    createShare: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const body = yield* decode(CreateShareGrant, input);
          if (body.expiresAt && !isFutureInstant(body.expiresAt)) {
            return yield* new ValidationError({
              message: "Share expiration must be in the future",
            });
          }
          const shares = yield* ShareGrantStore;
          return yield* shares.create(principal.tenantId, body);
        }),
        CreateShareGrantResult,
      ),
    listShares: () =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const shares = yield* ShareGrantStore;
          return yield* shares.list(principal.tenantId);
        }),
        Schema.Array(ShareGrantRecord),
      ),
    revokeShare: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const shares = yield* ShareGrantStore;
          return { revoked: yield* shares.revoke(principal.tenantId, id) };
        }),
      ),
  };
};

export type WithMcpServices = (
  context: Context,
  handler: (deps: McpDeps, runtime: AppRuntime) => Response | Promise<Response>,
) => Promise<Response>;

export const mountMcp = (app: Hono, withServices: WithMcpServices): void => {
  app.get("/.well-known/oauth-authorization-server", (context) =>
    withServices(context, (deps) =>
      deps.authorizationServer.authorizationServerMetadata(context.req.raw),
    ),
  );
  app.get("/.well-known/oauth-protected-resource", (context) =>
    withServices(context, (deps) =>
      deps.authorizationServer.protectedResourceMetadata(context.req.raw),
    ),
  );

  app.all("/mcp", (context) =>
    withServices(context, (deps, runtime) => {
      const handle = deps.authorizationServer.withMcpAuth(async (request, session) => {
        const tenantId = await deps.resolveTenant(session.userId);
        if (!tenantId) {
          return Response.json(
            {
              jsonrpc: "2.0",
              error: { code: -32001, message: "No keva tenant for this account" },
              id: null,
            },
            { status: 403 },
          );
        }
        const names = await deps.resolveActorNames(session.userId, session.clientId);
        const principal = principalFromMcpToken(session, tenantId, names);
        const engine = makeMcpEngine(principal, runtime);
        const server = createKevaMcpServer(engine, { scopes: principal.scopes });
        // Fresh server and transport per request keeps the MCP edge stateless.
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        try {
          await server.connect(transport);
          return await transport.handleRequest(request);
        } finally {
          await server.close();
        }
      });
      return handle(context.req.raw);
    }),
  );

  app.get("/api/connections", async (context) => {
    return withServices(context, async (deps) => {
      const session = await deps.authorizationServer.sessionApi.getSession({
        headers: context.req.raw.headers,
      });
      if (!session) {
        return context.json({ _tag: "Unauthorized", message: "Sign in required" }, 401);
      }
      return context.json(await deps.connections.list(session.user.id));
    });
  });

  app.delete("/api/connections/:id", async (context) => {
    return withServices(context, async (deps) => {
      const session = await deps.authorizationServer.sessionApi.getSession({
        headers: context.req.raw.headers,
      });
      if (!session) {
        return context.json({ _tag: "Unauthorized", message: "Sign in required" }, 401);
      }
      const revoked = await deps.connections.revoke(session.user.id, context.req.param("id"));
      return context.json({ revoked });
    });
  });
};
