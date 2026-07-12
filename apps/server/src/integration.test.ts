import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { ShareGrantStore } from "./shares.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const TOKEN = "secret-token";

const makeApp = () =>
  createApp({
    layer: Layer.mergeAll(
      MemoryMetadataStoreLive,
      MemoryBlobStoreLive(),
      StaticTokenAuthLive({ token: TOKEN, tenantId: "root" }),
      Layer.succeed(ApiTokenStore, {
        resolve: () => Effect.succeed(null),
        mint: () => Effect.die("not used"),
        list: () => Effect.succeed([]),
        revoke: () => Effect.succeed(false),
      }),
      Layer.succeed(ShareGrantStore, makeInMemoryShareGrantStore()),
      Layer.succeed(ViewStore, makeInMemoryViewStore()),
    ),
  });

const auth = { authorization: `Bearer ${TOKEN}` };

const loopback = (app: ReturnType<typeof makeApp>, absoluteUrl: string, init?: RequestInit) => {
  const url = new URL(absoluteUrl);
  return app.request(`${url.pathname}${url.search}`, init);
};

describe("server integration — HTTP roundtrip", () => {
  it("create → upload → confirm → query → download → delete", async () => {
    const app = makeApp();
    const bytes = new TextEncoder().encode("the quick brown fox");

    const initiatedResponse = await app.request("/api/items", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "fox.txt",
        contentType: "text/plain",
        size: bytes.byteLength,
      }),
    });
    expect(initiatedResponse.status).toBe(200);
    const initiated = (await initiatedResponse.json()) as {
      item: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };

    const uploaded = await loopback(app, initiated.uploadUrl, {
      method: "PUT",
      headers: { ...auth, ...initiated.headers },
      body: bytes,
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
      size: bytes.byteLength,
    });

    const patched = await app.request(`/api/items/${initiated.item.id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        set: { name: "renamed.txt", animal: "fox", tags: ["quick", "brown"] },
      }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: "renamed.txt" });

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        where: [{ key: "tags", op: "contains", value: "brown" }],
      }),
    });
    expect(queried.status).toBe(200);
    const queryBody = (await queried.json()) as { items: { id: string }[] };
    expect(queryBody.items.map((o) => o.id)).toContain(initiated.item.id);

    const contentResponse = await app.request(`/api/items/${initiated.item.id}/content`, {
      method: "GET",
      headers: auth,
    });
    expect(contentResponse.status).toBe(200);
    const { url } = (await contentResponse.json()) as { url: string };
    const downloaded = await loopback(app, url);
    expect(downloaded.status).toBe(200);
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toBe("the quick brown fox");

    const deleted = await app.request(`/api/items/${initiated.item.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.status).toBe(200);

    const gone = await app.request(`/api/items/${initiated.item.id}`, {
      method: "GET",
      headers: auth,
    });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ _tag: "NotFound" });
  });

  const makeReadyItem = async (app: ReturnType<typeof makeApp>, name: string) => {
    const bytes = new TextEncoder().encode(name);
    const initiatedResponse = await app.request("/api/items", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        contentType: "text/plain",
        size: bytes.byteLength,
      }),
    });
    const initiated = (await initiatedResponse.json()) as {
      item: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };
    await loopback(app, initiated.uploadUrl, {
      method: "PUT",
      headers: { ...auth, ...initiated.headers },
      body: bytes,
    });
    await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: auth,
    });
    return initiated.item.id;
  };

  it("batch delete removes every valid id and is idempotent for unknown ones", async () => {
    const app = makeApp();
    const a = await makeReadyItem(app, "a.txt");
    const b = await makeReadyItem(app, "b.txt");
    const unknown = "00000000-0000-0000-0000-000000000000";

    const response = await app.request("/api/items/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [a, b, unknown] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      deleted: string[];
      failed: { id: string }[];
    };
    expect(body.deleted.sort()).toEqual([a, b, unknown].sort());
    expect(body.failed).toEqual([]);

    for (const id of [a, b]) {
      const gone = await app.request(`/api/items/${id}`, {
        method: "GET",
        headers: auth,
      });
      expect(gone.status).toBe(404);
    }
  });

  it("rejects an empty batch delete with a typed ValidationError (400)", async () => {
    const app = makeApp();
    const response = await app.request("/api/items/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("rejects malformed item ids with a typed ValidationError (400)", async () => {
    const app = makeApp();
    const response = await app.request("/api/items/not-a-uuid", {
      method: "GET",
      headers: auth,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("rejects malformed batch delete ids with a typed ValidationError (400)", async () => {
    const app = makeApp();
    const response = await app.request("/api/items/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: ["not-a-uuid"] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("returns a typed NotFound (404) for an unknown id", async () => {
    const app = makeApp();
    const response = await app.request("/api/items/00000000-0000-0000-0000-000000000000", {
      method: "GET",
      headers: auth,
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ _tag: "NotFound" });
  });

  it("returns a typed Unauthorized (401) for a bad token", async () => {
    const app = makeApp();
    const response = await app.request("/api/query", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ where: [] }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ _tag: "Unauthorized" });
  });

  it("returns a typed ValidationError (400) for a malformed query", async () => {
    const app = makeApp();
    const response = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ where: [{ key: "x", op: "gt", value: true }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });
});
