import { makeKevaEngine } from "@keva/core";
import { createKevaMcpServer, type McpEngine } from "@keva/mcp";
import {
  ItemId,
  ItemPatch,
  Query,
  Internal,
  ValidationError,
  type KevaError,
  type Principal,
} from "@keva/schema";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Exit, ManagedRuntime, Option, Schema } from "effect";
import type { Hono } from "hono";
import type { AppServices } from "./app.js";
import { mcpScopesToKevaScopes } from "./auth.js";
import type { ConnectionStore, McpAuthorizationServer } from "./better-auth.js";

type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

export interface McpAccessToken {
  readonly userId: string;
  readonly scopes: string;
}

export interface McpDeps {
  readonly authorizationServer: McpAuthorizationServer;
  readonly resolveTenant: (userId: string) => Promise<string | null>;
  readonly connections: ConnectionStore;
}

export const principalFromMcpToken = (token: McpAccessToken, tenantId: string): Principal => ({
  tenantId,
  scopes: mcpScopesToKevaScopes(token.scopes),
  via: "token",
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

// Re-decode tool input with the canonical Effect schemas before reaching core.
const makeMcpEngine = (principal: Principal, runtime: AppRuntime): McpEngine => {
  const engine = makeKevaEngine(principal);
  return {
    queryItems: (input) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const query = yield* decode(Query, input);
          return yield* engine.query(query);
        }),
      ),
    getItem: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return yield* engine.get(itemId);
        }),
      ),
    getContentUrl: (id) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, id);
          return yield* engine.download(itemId);
        }),
      ),
    setProperties: (input) =>
      runEngine(
        runtime,
        Effect.gen(function* () {
          const itemId = yield* decode(ItemId, input.id);
          const patch = yield* decode(ItemPatch, {
            ...(input.set !== undefined ? { set: input.set } : {}),
            ...(input.unset !== undefined ? { unset: input.unset } : {}),
          });
          return yield* engine.patch(itemId, patch);
        }),
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

const mountDiscovery = (app: Hono, authorizationServer: McpAuthorizationServer): void => {
  app.get("/.well-known/oauth-authorization-server", (context) =>
    authorizationServer.authorizationServerMetadata(context.req.raw),
  );
  app.get("/.well-known/oauth-protected-resource", (context) =>
    authorizationServer.protectedResourceMetadata(context.req.raw),
  );
};

export const mountMcp = (app: Hono, deps: McpDeps, runtime: AppRuntime): void => {
  mountDiscovery(app, deps.authorizationServer);

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
    const principal = principalFromMcpToken(session, tenantId);
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

  app.all("/mcp", (context) => handle(context.req.raw));

  app.get("/api/connections", async (context) => {
    const session = await deps.authorizationServer.sessionApi.getSession({
      headers: context.req.raw.headers,
    });
    if (!session) {
      return context.json({ _tag: "Unauthorized", message: "Sign in required" }, 401);
    }
    return context.json(await deps.connections.list(session.user.id));
  });

  app.delete("/api/connections/:id", async (context) => {
    const session = await deps.authorizationServer.sessionApi.getSession({
      headers: context.req.raw.headers,
    });
    if (!session) {
      return context.json({ _tag: "Unauthorized", message: "Sign in required" }, 401);
    }
    const revoked = await deps.connections.revoke(session.user.id, context.req.param("id"));
    return context.json({ revoked });
  });
};
