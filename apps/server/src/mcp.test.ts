import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiTokenStore, mcpScopesToKevaScopes, StaticTokenAuthLive } from "./auth.js";
import { createApp } from "./app.js";
import type { McpAuthorizationServer } from "./better-auth.js";
import { type McpDeps, principalFromMcpToken } from "./mcp.js";
import { ShareGrantStore } from "./shares.js";
import { testSql } from "./test/db.js";
import { s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const sql = testSql();
let mock: S3Mock;
beforeAll(async () => {
  mock = await startS3Mock();
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await mock.close();
});

const baseLayer = () =>
  Layer.mergeAll(
    Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
    S3BlobStoreLive(s3MockConfig(mock)),
    StaticTokenAuthLive({ token: "test-secret", tenantId: "test-tenant" }),
    Layer.succeed(ApiTokenStore, {
      resolve: () => Effect.succeed(null),
      mint: () => Effect.die("not used"),
      list: () => Effect.succeed([]),
      revoke: () => Effect.succeed(false),
    }),
    Layer.succeed(ShareGrantStore, makeInMemoryShareGrantStore()),
    Layer.succeed(ViewStore, makeInMemoryViewStore()),
  );

const stubAuthorizationServer = (overrides: {
  mcpSession?: { userId: string; scopes: string; clientId: string } | null;
  session?: { user: { id: string } } | null;
}): McpAuthorizationServer => ({
  authorizationServerMetadata: () => Response.json({ issuer: "http://localhost:8787" }),
  protectedResourceMetadata: () => Response.json({ resource: "http://localhost:8787/mcp" }),
  withMcpAuth: (handler) => async (request) => {
    if (!overrides.mcpSession) {
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="http://localhost:8787/.well-known/oauth-protected-resource"',
        },
      });
    }
    return handler(request, overrides.mcpSession);
  },
  sessionApi: {
    getSession: async () => overrides.session ?? null,
  },
});

const stubMcpDeps = (overrides: {
  mcpSession?: { userId: string; scopes: string; clientId: string } | null;
  session?: { user: { id: string } } | null;
  connections?: McpDeps["connections"];
}): McpDeps => ({
  authorizationServer: stubAuthorizationServer(overrides),
  resolveTenant: async () => "test-tenant",
  resolveActorNames: async () => ({ userName: "Test User", clientName: "Test Client" }),
  connections: overrides.connections ?? {
    list: async () => [],
    revoke: async () => false,
  },
});

describe("mcpScopesToKevaScopes", () => {
  it("maps keva:* scopes onto the engine's Scope enum", () => {
    expect(mcpScopesToKevaScopes("keva:read keva:write")).toEqual(["read", "write"]);
    expect(mcpScopesToKevaScopes("openid keva:delete")).toEqual(["delete"]);
  });

  it("ignores OIDC and unknown scopes", () => {
    expect(mcpScopesToKevaScopes("openid profile email")).toEqual([]);
    expect(mcpScopesToKevaScopes("keva:admin keva:read")).toEqual(["read"]);
  });

  it("grants no keva permissions when no keva scope is granted", () => {
    expect(mcpScopesToKevaScopes("")).toEqual([]);
  });

  it("deduplicates", () => {
    expect(mcpScopesToKevaScopes("keva:read keva:read")).toEqual(["read"]);
  });
});

describe("principalFromMcpToken", () => {
  it("produces a token principal scoped to the resolved tenant", () => {
    const principal = principalFromMcpToken(
      { userId: "u1", scopes: "keva:read keva:write", clientId: "client-1" },
      "tenant-a",
      { userName: "Kai", clientName: "Claude" },
    );
    expect(principal).toEqual({
      tenantId: "tenant-a",
      scopes: ["read", "write"],
      via: "token",
      actor: {
        user: { id: "u1", name: "Kai" },
        agent: { clientId: "client-1", name: "Claude" },
      },
    });
  });

  it("preserves an empty granted keva scope set", () => {
    const principal = principalFromMcpToken(
      { userId: "u1", scopes: "", clientId: "client-1" },
      "tenant-a",
      { userName: null, clientName: null },
    );
    expect(principal.scopes).toEqual([]);
    expect(principal.via).toBe("token");
  });

  it("falls back to raw ids when display names are unresolved", () => {
    const principal = principalFromMcpToken(
      { userId: "u1", scopes: "keva:read", clientId: "client-1" },
      "tenant-a",
      { userName: null, clientName: null },
    );
    expect(principal.actor).toEqual({
      user: { id: "u1", name: "u1" },
      agent: { clientId: "client-1", name: "client-1" },
    });
  });
});

describe("/mcp route", () => {
  it("returns 401 with a WWW-Authenticate resource pointer when unauthenticated", async () => {
    const app = createApp({ layer: baseLayer(), mcp: stubMcpDeps({ mcpSession: null }) });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource",
    );
  });
});

describe("/api/connections", () => {
  it("requires a session", async () => {
    const app = createApp({ layer: baseLayer(), mcp: stubMcpDeps({ session: null }) });
    const response = await app.request("/api/connections");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("lists the signed-in user's connections", async () => {
    const app = createApp({
      layer: baseLayer(),
      mcp: stubMcpDeps({
        session: { user: { id: "u1" } },
        connections: {
          list: async (userId) => [
            {
              clientId: `client-for-${userId}`,
              name: "Claude",
              scopes: ["keva:read"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          revoke: async () => true,
        },
      }),
    });
    const response = await app.request("/api/connections");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        clientId: "client-for-u1",
        name: "Claude",
        scopes: ["keva:read"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("revokes a connection for the signed-in user", async () => {
    let revoked: { userId: string; clientId: string } | null = null;
    const app = createApp({
      layer: baseLayer(),
      mcp: stubMcpDeps({
        session: { user: { id: "u1" } },
        connections: {
          list: async () => [],
          revoke: async (userId, clientId) => {
            revoked = { userId, clientId };
            return true;
          },
        },
      }),
    });
    const response = await app.request("/api/connections/client-9", { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(revoked).toEqual({ userId: "u1", clientId: "client-9" });
  });
});
