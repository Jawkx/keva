import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { createApp, type AppServices } from "./app.js";
import { ShareGrantStore } from "./shares.js";
import { testSql } from "./test/db.js";
import { s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const sql = testSql();
let mock: S3Mock;
let layer: Layer.Layer<AppServices>;

const makeLayer = (metadata = makePostgresMetadataStore(sql)): Layer.Layer<AppServices> =>
  Layer.mergeAll(
    Layer.succeed(MetadataStore, metadata),
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

beforeAll(async () => {
  mock = await startS3Mock();
  layer = makeLayer();
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await mock.close();
});

const auth = { authorization: "Bearer test-secret" };

const putToStorage = (
  initiated: { uploadUrl: string; headers: Record<string, string> },
  body: string,
) =>
  fetch(initiated.uploadUrl, {
    method: "PUT",
    headers: initiated.headers,
    body,
  });

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
  await putToStorage(initiated, "x");
  await app.request(`/api/items/${initiated.item.id}/confirm`, { method: "POST", headers: auth });
  const patched = await app.request(`/api/items/${initiated.item.id}`, {
    method: "PATCH",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ set: properties }),
  });
  expect(patched.status).toBe(200);
  const patchedItem = await patched.json();
  expect(patchedItem).not.toHaveProperty("tenantId");
  expect(patchedItem).not.toHaveProperty("storageKey");
  expect(patchedItem).not.toHaveProperty("stagingKey");
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

  it("releases request-scoped runtimes and external resources on every path", async () => {
    let disposed = 0;
    const app = createApp({
      getRequestServices: () => ({
        layer,
        authHandler: () => {
          throw new Error("handler failed");
        },
        dispose: async () => {
          disposed++;
        },
      }),
    });

    expect((await app.request("/ready")).status).toBe(200);
    expect((await app.request("/api/query", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/auth/session")).status).toBe(500);
    expect(disposed).toBe(3);
  });

  it("requires authentication", async () => {
    const app = createApp({ layer });
    const unauthorized = await app.request("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("sanitizes defects while recording their type without their message", async () => {
    const metadata = makePostgresMetadataStore(sql);
    const app = createApp({
      layer: makeLayer({
        ...metadata,
        query: () => Effect.die(new Error("database password secret-123")),
      }),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await app.request("/api/query", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      const output = log.mock.calls.flat().join(" ");

      expect(response.status).toBe(500);
      expect(payload).toEqual({ _tag: "Internal", message: "Internal server error" });
      expect(output).toContain('"defectTypes":["Error"]');
      expect(output).not.toContain("secret-123");
    } finally {
      log.mockRestore();
      await app.dispose();
    }
  });

  it("serves distinct property key and value suggestions", async () => {
    const app = createApp({ layer });
    await seedItem(app, "one.txt", { location: "bali", rating: "five" });
    await seedItem(app, "two.txt", { location: "tokyo", rating: "five" });

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

  it("searches property suggestions after filtering values", async () => {
    const app = createApp({ layer });
    await seedItem(app, "finance.txt", { department: "Finance", teams: ["FinOps", "Legal"] });

    const response = await app.request("/api/properties/search?q=fin", { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [
        { key: "department", value: "Finance" },
        { key: "teams", value: "FinOps" },
      ],
    });

    const tooShort = await app.request("/api/properties/search?q=f", { headers: auth });
    expect(tooShort.status).toBe(400);
  });
});
