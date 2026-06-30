import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import type { MintTokenResult, Principal, TokenRecord } from "@keva/schema";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  ApiTokenStore,
  type ApiTokenStoreService,
  shouldRefreshLastUsed,
  TokenAndStaticAuthFromStoreLive,
  type SessionResolver,
} from "./auth.js";

/**
 * Server-level token subsystem. In the merged implementation, token management
 * is gated behind an *admin session* (`requireAdminSession`): a static API
 * token (via: "token") is rejected with Forbidden, and only a session with the
 * `admin` scope may mint / list / revoke. We drive the session via a
 * `sessionResolver` and back the store with an in-memory `ApiTokenStore` so the
 * full mint → use → scope-enforce → list → revoke flow runs without Postgres.
 *
 * Note: in merged, token-store ops surface StorageUnavailable on a DB error
 * (not the old `orDie`); these tests assert the happy-path HTTP behaviour, not
 * that legacy.
 */

const STATIC = "static-token";
const TENANT = "acme";
const ADMIN_COOKIE = "keva_session=admin";

// A minimal in-memory ApiTokenStore: mints `keva_sk_<id>_<secret>` tokens and
// resolves them back to a principal carrying the requested scopes.
const makeInMemoryTokenStore = (): ApiTokenStoreService => {
  const records = new Map<string, { record: TokenRecord; secret: string }>();
  return {
    resolve: (token) =>
      Effect.sync(() => {
        const match = /^keva_sk_([^_]+)_(.+)$/.exec(token);
        if (!match) return null;
        const [, id, secret] = match;
        const entry = records.get(id!);
        if (!entry || entry.secret !== secret) return null;
        return {
          tenantId: entry.record.tenantId,
          scopes: [...entry.record.scopes],
          via: "token" as const,
        } satisfies Principal;
      }),
    mint: (tenantId, input) =>
      Effect.sync<MintTokenResult>(() => {
        const id = crypto.randomUUID().replaceAll("-", "");
        const secret = crypto.randomUUID().replaceAll("-", "");
        const record: TokenRecord = {
          id,
          tenantId,
          name: input.name,
          scopes: [...input.scopes],
          createdAt: new Date().toISOString(),
          expiresAt: input.expiresAt ?? null,
          lastUsedAt: null,
        };
        records.set(id, { record, secret });
        return { token: `keva_sk_${id}_${secret}`, record };
      }),
    list: (tenantId) =>
      Effect.sync(() =>
        [...records.values()]
          .map((entry) => entry.record)
          .filter((record) => record.tenantId === tenantId),
      ),
    revoke: (tenantId, id) =>
      Effect.sync(() => {
        const entry = records.get(id);
        if (!entry || entry.record.tenantId !== tenantId) return false;
        return records.delete(id);
      }),
  };
};

// The web session: an admin cookie maps to the tenant with the admin scope.
const sessionResolver = async (headers: Headers) =>
  headers.get("cookie")?.includes(ADMIN_COOKIE)
    ? { tenantId: TENANT, scopes: ["read", "write", "delete", "admin"] as const }
    : null;

const makeApp = (resolver: SessionResolver = sessionResolver) => {
  const tokenStore = makeInMemoryTokenStore();
  const tokens = Layer.succeed(ApiTokenStore, tokenStore);
  const auth = TokenAndStaticAuthFromStoreLive({
    staticToken: STATIC,
    tenantId: TENANT,
    sessionResolver: resolver,
  }).pipe(Layer.provide(tokens));
  return createApp({
    layer: Layer.mergeAll(MemoryMetadataStoreLive, MemoryBlobStoreLive(), tokens, auth),
  });
};

const adminSession = {
  cookie: ADMIN_COOKIE,
  "content-type": "application/json",
};

describe("server token subsystem", () => {
  it("throttles token last-used refresh decisions", () => {
    const now = new Date("2026-01-01T00:10:00.000Z");
    expect(shouldRefreshLastUsed(null, now)).toBe(true);
    expect(shouldRefreshLastUsed("2026-01-01T00:06:00.000Z", now)).toBe(false);
    expect(shouldRefreshLastUsed("2026-01-01T00:04:59.000Z", now)).toBe(true);
  });

  it("keeps missing-cookie requests unauthorized without hitting session storage", async () => {
    const app = makeApp(async () => {
      throw new Error("session storage should not be called");
    });
    const response = await app.request("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ where: [] }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("surfaces session resolver failures as storage unavailability", async () => {
    const app = makeApp(async () => {
      throw new Error("database unavailable");
    });
    const response = await app.request("/api/query", {
      method: "POST",
      headers: {
        cookie: "keva_session=broken",
        "content-type": "application/json",
      },
      body: JSON.stringify({ where: [] }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      _tag: "StorageUnavailable",
    });
  });

  it("rejects token management without an admin session (Forbidden)", async () => {
    const app = makeApp();
    // A static API token authenticates (via: "token") but is NOT an admin
    // session, so token management is Forbidden.
    const response = await app.request("/api/tokens", {
      method: "POST",
      headers: {
        authorization: `Bearer ${STATIC}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "k", scopes: ["read"] }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ _tag: "Forbidden" });
  });

  it("mints a token (admin session) and uses it from the API", async () => {
    const app = makeApp();
    const minted = await app.request("/api/tokens", {
      method: "POST",
      headers: adminSession,
      body: JSON.stringify({ name: "agent-key", scopes: ["read", "write"] }),
    });
    expect(minted.status).toBe(200);
    const mintBody = (await minted.json()) as MintTokenResult;
    expect(mintBody.token).toMatch(/^keva_sk_/);
    expect(mintBody.record.scopes).toEqual(["read", "write"]);

    // use the minted token: upload an item that inherits the minter's tenant
    const agentAuth = { authorization: `Bearer ${mintBody.token}` };
    const initiated = await app.request("/api/items", {
      method: "POST",
      headers: { ...agentAuth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "agent.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });
    expect(initiated.status).toBe(200);
    const initiatedBody = (await initiated.json()) as {
      item: { tenantId: string };
    };
    expect(initiatedBody.item.tenantId).toBe(TENANT);
  });

  it("enforces the minted token's scopes (read-only cannot write)", async () => {
    const app = makeApp();
    const minted = await app.request("/api/tokens", {
      method: "POST",
      headers: adminSession,
      body: JSON.stringify({ name: "ro", scopes: ["read"] }),
    });
    const { token } = (await minted.json()) as MintTokenResult;

    const initiate = await app.request("/api/items", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "x", contentType: "text/plain", size: 1 }),
    });
    expect(initiate.status).toBe(403);
    expect(await initiate.json()).toMatchObject({ _tag: "Forbidden" });
  });

  it("lists and revokes tokens; a revoked token stops working", async () => {
    const app = makeApp();
    const minted = await app.request("/api/tokens", {
      method: "POST",
      headers: adminSession,
      body: JSON.stringify({ name: "temp", scopes: ["read"] }),
    });
    const mintBody = (await minted.json()) as MintTokenResult;
    const id = mintBody.record.id;

    const listed = await app.request("/api/tokens", {
      method: "GET",
      headers: { cookie: ADMIN_COOKIE },
    });
    expect(listed.status).toBe(200);
    const records = (await listed.json()) as TokenRecord[];
    expect(records.map((r) => r.id)).toContain(id);

    const revoked = await app.request(`/api/tokens/${id}`, {
      method: "DELETE",
      headers: { cookie: ADMIN_COOKIE },
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ revoked: true });

    // the revoked token no longer authenticates
    const reuse = await app.request("/api/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${mintBody.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ where: [] }),
    });
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toMatchObject({ _tag: "Unauthorized" });
  });
});
