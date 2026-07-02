import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { createApp } from "./app.js";

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
);

const auth = { authorization: "Bearer test-secret" };

// Upload → confirm → patch an item to a ready state carrying `properties`.
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
    headers: initiated.headers,
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
      headers: initiated.headers,
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

    // Missing `key` is a validation error; both routes require authentication.
    const missing = await app.request("/api/properties/values", { headers: auth });
    expect(missing.status).toBe(400);
    const unauthorized = await app.request("/api/properties/keys");
    expect(unauthorized.status).toBe(401);
  });
});
