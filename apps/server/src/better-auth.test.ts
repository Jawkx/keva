import { afterAll, describe, expect, it } from "vitest";
import {
  createBetterAuth,
  isAllowedMcpRedirectUri,
  makeConnectionStore,
  makeMcpAuthorizationServer,
} from "./better-auth.js";
import { makeDatabaseUnit } from "./database.js";
import * as authSchema from "./auth-schema.js";
import { requireTestDatabaseUrl } from "./test/db.js";
import { eq } from "drizzle-orm";

const database = makeDatabaseUnit(requireTestDatabaseUrl());
const auth = createBetterAuth({
  database: database.db,
  secret: "test-only-better-auth-secret-at-least-32-characters",
  baseURL: "http://localhost:8787",
});

afterAll(async () => database.dispose());

describe("MCP OAuth registration", () => {
  it("accepts only secure remote or loopback callback URIs", () => {
    expect(isAllowedMcpRedirectUri("https://client.example/oauth/callback")).toBe(true);
    expect(isAllowedMcpRedirectUri("http://127.0.0.1:49152/callback")).toBe(true);
    expect(isAllowedMcpRedirectUri("com.example.client:/oauth/callback")).toBe(true);
    expect(isAllowedMcpRedirectUri("http://client.example/callback")).toBe(false);
    expect(isAllowedMcpRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedMcpRedirectUri("https://client.example/callback#fragment")).toBe(false);
  });

  it("supplies a stable name when dynamic registration omits client_name", async () => {
    const response = await auth.handler(
      new Request("http://localhost:8787/api/auth/mcp/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:49152/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ client_name: "MCP Client" });
  });

  it("advertises Keva scopes in authorization-server metadata", async () => {
    const server = makeMcpAuthorizationServer(auth);
    const response = await server.authorizationServerMetadata(
      new Request("http://localhost:8787/.well-known/oauth-authorization-server"),
    );
    const metadata = (await response.json()) as { scopes_supported: string[] };

    expect(metadata.scopes_supported).toContain("keva:read");
    expect(metadata.scopes_supported).toContain("keva:delete");
  });
});

describe("profile avatars", () => {
  it("validates and persists avatar recipes through Better Auth", async () => {
    const suffix = crypto.randomUUID();
    const email = `avatar-${suffix}@example.com`;
    const signUp = await auth.handler(
      new Request("http://localhost:8787/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Avatar User", email, password: "password@1" }),
      }),
    );
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const avatar = JSON.stringify({ version: 1, seed: suffix, glasses: "variant03" });
    const update = await auth.handler(
      new Request("http://localhost:8787/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie! },
        body: JSON.stringify({ avatar }),
      }),
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ status: true });

    const invalid = await auth.handler(
      new Request("http://localhost:8787/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie! },
        body: JSON.stringify({
          avatar: JSON.stringify({ version: 1, seed: suffix, glasses: "variant99" }),
        }),
      }),
    );
    expect(invalid.status).toBe(400);

    const [stored] = await database.db
      .select({ avatar: authSchema.user.avatar })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, email));
    expect(stored?.avatar).toBe(avatar);

    const reset = await auth.handler(
      new Request("http://localhost:8787/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie! },
        body: JSON.stringify({ avatar: null }),
      }),
    );
    expect(reset.status).toBe(200);
    const [resetUser] = await database.db
      .select({ avatar: authSchema.user.avatar })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, email));
    expect(resetUser?.avatar).toBeNull();
    await database.db.delete(authSchema.user).where(eq(authSchema.user.email, email));
  });
});

describe("MCP connection lifecycle", () => {
  it("combines authorization, active-token, and observed-use state", async () => {
    const suffix = crypto.randomUUID();
    const userId = `mcp-user-${suffix}`;
    const clientId = `mcp-client-${suffix}`;
    const now = new Date();
    await database.db.insert(authSchema.user).values({
      id: userId,
      name: "MCP Test User",
      email: `${suffix}@example.com`,
    });
    await database.db.insert(authSchema.oauthApplication).values({
      id: `app-${suffix}`,
      name: "Test Agent",
      clientId,
      redirectUrls: "http://127.0.0.1:49152/callback",
      type: "public",
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(authSchema.oauthConsent).values({
      id: `consent-${suffix}`,
      clientId,
      userId,
      scopes: "openid keva:read",
      consentGiven: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(authSchema.oauthAccessToken).values({
      id: `token-${suffix}`,
      accessToken: `access-${suffix}`,
      refreshToken: `refresh-${suffix}`,
      accessTokenExpiresAt: new Date(now.getTime() + 60_000),
      refreshTokenExpiresAt: new Date(now.getTime() + 120_000),
      clientId,
      userId,
      scopes: "openid keva:read",
      createdAt: now,
      updatedAt: now,
    });

    const store = makeConnectionStore(database.db);
    await store.observe(userId, clientId);

    expect(await store.list(userId)).toEqual([
      expect.objectContaining({
        clientId,
        name: "Test Agent",
        active: true,
        observed: true,
        lastSeenAt: expect.any(String),
        scopes: expect.arrayContaining(["openid", "keva:read"]),
      }),
    ]);
    expect(await store.clientName(clientId)).toBe("Test Agent");
    expect(await store.revoke(userId, clientId)).toBe(true);
    expect(await store.list(userId)).toEqual([]);
  });
});
