import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { createApp } from "./app.js";
import { ShareGrantStore } from "./shares.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const layer = Layer.mergeAll(
  MemoryMetadataStoreLive,
  MemoryBlobStoreLive(),
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

const auth = { authorization: "Bearer test-secret" };

const seedItem = async (
  app: ReturnType<typeof createApp>,
  name: string,
  properties: Record<string, unknown>,
) => {
  const initiatedResponse = await app.request("/api/items", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name, contentType: "text/plain", size: 1 }),
  });
  const initiated = (await initiatedResponse.json()) as {
    item: { id: string };
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const uploadUrl = new URL(initiated.uploadUrl);
  await app.request(`${uploadUrl.pathname}${uploadUrl.search}`, {
    method: "PUT",
    headers: { ...auth, ...initiated.headers },
    body: "x",
  });
  await app.request(`/api/items/${initiated.item.id}/confirm`, { method: "POST", headers: auth });
  await app.request(`/api/items/${initiated.item.id}`, {
    method: "PATCH",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ set: properties }),
  });
  return initiated.item.id;
};

describe("server API", () => {
  it("blocks organization-management endpoints", async () => {
    const app = createApp({ layer });
    const response = await app.request("/api/auth/organization/create", { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ _tag: "Forbidden" });
  });

  it("keeps liveness separate from dependency-aware readiness", async () => {
    const app = createApp({ layer });

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/ready")).status).toBe(200);
  });

  it("protects admin usage routes with the separate admin token", async () => {
    const adminUser = {
      id: "user-1",
      name: "Admin Test",
      email: "admin@example.com",
      tenantId: "tenant-1",
      usedBytes: 25,
      quotaBytes: 100,
      quotaSource: "custom" as const,
    };
    const updates: Array<number | null> = [];
    const app = createApp({
      layer,
      admin: {
        token: "admin-secret",
        store: {
          listUsers: async () => [adminUser],
          setQuota: async (_userId, quotaBytes) => {
            updates.push(quotaBytes);
            return {
              ...adminUser,
              quotaBytes,
              quotaSource: quotaBytes === null ? "unlimited" : "custom",
            };
          },
        },
      },
    });

    expect((await app.request("/api/admin/users")).status).toBe(401);
    const listed = await app.request("/api/admin/users", {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ users: [adminUser] });

    // 0 is a real cap (blocks all uploads), not an unlimited sentinel.
    const blocked = await app.request("/api/admin/users/user-1/quota", {
      method: "PUT",
      headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
      body: JSON.stringify({ quotaBytes: 0 }),
    });
    expect(blocked.status).toBe(200);
    // -1 and null are the unlimited sentinels.
    for (const sentinel of [-1, null]) {
      const unlimited = await app.request("/api/admin/users/user-1/quota", {
        method: "PUT",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ quotaBytes: sentinel }),
      });
      expect(unlimited.status).toBe(200);
    }
    expect(updates).toEqual([0, null, null]);
  });

  it("requires authentication and completes the local upload flow", async () => {
    const app = createApp({ layer });
    const unauthorized = await app.request("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ _tag: "Unauthorized" });

    const initiatedResponse = await app.request("/api/items", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "hello.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });
    expect(initiatedResponse.status).toBe(200);
    const initiated = (await initiatedResponse.json()) as {
      item: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };

    const uploadUrl = new URL(initiated.uploadUrl);
    const uploaded = await app.request(`${uploadUrl.pathname}${uploadUrl.search}`, {
      method: "PUT",
      headers: { ...auth, ...initiated.headers },
      body: "hello",
    });
    expect(uploaded.status).toBe(200);

    const confirmed = await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: auth,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      id: initiated.item.id,
      status: "ready",
      size: 5,
    });

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        where: [{ key: "name", op: "eq", value: "hello.txt" }],
      }),
    });
    expect(queried.status).toBe(200);
    expect(((await queried.json()) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("rejects oversized proxy uploads before staging them", async () => {
    const app = createApp({ layer });
    const initiated = (await (
      await app.request("/api/items", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name: "small.txt", contentType: "text/plain", size: 1 }),
      })
    ).json()) as { item: { id: string }; uploadUrl: string; headers: Record<string, string> };
    const uploadUrl = new URL(initiated.uploadUrl);

    const uploaded = await app.request(`${uploadUrl.pathname}${uploadUrl.search}`, {
      method: "PUT",
      headers: { ...auth, ...initiated.headers },
      body: "too large",
    });
    expect(uploaded.status).toBe(400);

    const confirmed = await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: auth,
    });
    expect(confirmed.status).toBe(409);
  });

  it("serves distinct property key and value suggestions", async () => {
    const app = createApp({ layer });
    await seedItem(app, "one.txt", { location: "bali", rating: 5 });
    await seedItem(app, "two.txt", { location: "tokyo", rating: 5 });

    const keys = await app.request("/api/properties/keys", { headers: auth });
    expect(keys.status).toBe(200);
    expect(await keys.json()).toEqual({ keys: ["location", "rating"] });

    const values = await app.request("/api/properties/values?key=location", { headers: auth });
    expect(values.status).toBe(200);
    expect(await values.json()).toEqual({ values: ["bali", "tokyo"] });

    const missing = await app.request("/api/properties/values", { headers: auth });
    expect(missing.status).toBe(400);
    const unauthorized = await app.request("/api/properties/keys");
    expect(unauthorized.status).toBe(401);
  });
});
