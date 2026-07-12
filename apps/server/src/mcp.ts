import { makeKevaEngine } from "@keva/core";
import { createKevaMcpServer, type McpEngine } from "@keva/mcp";
import {
  ItemId,
  ItemPatch,
  DownloadResult,
  KevaItem,
  PropertyKeysResult,
  PropertyValuesResult,
  Query,
  QueryResult,
  UsageResult,
  Internal,
  ValidationError,
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

// @keva/mcp turns thrown messages into tool errors, so keep failures client-safe.
const runEngine = async <A>(
  runtime: AppRuntime,
  effect: Effect.Effect<A, KevaError, AppServices>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Option.getOrElse(
    Cause.failureOption(exit.cause),
    () => new Internal({ message: "Internal server error" }),
  );
  throw new Error(error.message);
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
          return yield* engine.query(query);
        }),
        QueryResult,
      ),
    getItem: (id) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return yield* engine.get(itemId);
        }),
        KevaItem,
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
    getUsage: () => runValidated(runtime, engine.usage(), UsageResult),
    listPropertyKeys: () => runValidated(runtime, engine.propertyKeys(), PropertyKeysResult),
    listPropertyValues: ({ key }) =>
      runValidated(runtime, engine.propertyValues(key), PropertyValuesResult),
    setProperties: (input) =>
      runValidated(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, input.id);
          const patch = yield* decode(ItemPatch, {
            ...(input.set !== undefined ? { set: input.set } : {}),
            ...(input.unset !== undefined ? { unset: input.unset } : {}),
          });
          return yield* engine.patch(itemId, patch);
        }),
        KevaItem,
      ),
    deleteItem: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          yield* engine.delete(itemId);
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
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        void server.close();
        return response;
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
