import {
  MemoryBlobStoreLive,
  MemoryMetadataStoreLive,
} from "@keva/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";

/**
 * Server-level acceptance: the full create → upload (loopback) → confirm →
 * query → download roundtrip over HTTP through the in-process Hono app, plus
 * forced NotFound / Unauthorized / ValidationError arriving as the correct
 * status and typed `_tag` error body.
 *
 * Bytes are PUT to the presigned upload URL and GET from the presigned
 * download URL, both of which loop back into the same app's `/__dev/blobs`
 * routes — the server itself never streams object bytes.
 */

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
    ),
  });

const auth = { authorization: `Bearer ${TOKEN}` };

// Route an absolute presigned URL (loopback) back into the app.
const loopback = (app: ReturnType<typeof makeApp>, absoluteUrl: string, init?: RequestInit) => {
  const url = new URL(absoluteUrl);
  return app.request(`${url.pathname}${url.search}`, init);
};

describe("server integration — HTTP roundtrip", () => {
  it("create → upload → confirm → query → download → delete", async () => {
    const app = makeApp();
    const bytes = new TextEncoder().encode("the quick brown fox");

    const initiatedResponse = await app.request("/api/objects", {
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
      object: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };

    // upload bytes straight to the presigned (loopback) staging URL
    const uploaded = await loopback(app, initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: bytes,
    });
    expect(uploaded.status).toBe(200);

    const confirmed = await app.request(
      `/api/objects/${initiated.object.id}/confirm`,
      { method: "POST", headers: auth },
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      id: initiated.object.id,
      status: "ready",
      size: bytes.byteLength,
    });

    // write attributes, then query by one of them
    const patched = await app.request(
      `/api/objects/${initiated.object.id}/attributes`,
      {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ set: { animal: "fox", tags: ["quick", "brown"] } }),
      },
    );
    expect(patched.status).toBe(200);

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        where: [{ key: "tags", op: "contains", value: "brown" }],
      }),
    });
    expect(queried.status).toBe(200);
    const queryBody = (await queried.json()) as { objects: { id: string }[] };
    expect(queryBody.objects.map((o) => o.id)).toContain(initiated.object.id);

    // download: presigned GET → loopback → exact bytes
    const contentResponse = await app.request(
      `/api/objects/${initiated.object.id}/content`,
      { method: "GET", headers: auth },
    );
    expect(contentResponse.status).toBe(200);
    const { url } = (await contentResponse.json()) as { url: string };
    const downloaded = await loopback(app, url);
    expect(downloaded.status).toBe(200);
    expect(new TextDecoder().decode(await downloaded.arrayBuffer())).toBe(
      "the quick brown fox",
    );

    // delete, then a get is a typed NotFound
    const deleted = await app.request(`/api/objects/${initiated.object.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.status).toBe(200);

    const gone = await app.request(`/api/objects/${initiated.object.id}`, {
      method: "GET",
      headers: auth,
    });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ _tag: "NotFound" });
  });

  // Create a ready object via the full initiate → upload → confirm flow.
  const makeReadyObject = async (
    app: ReturnType<typeof makeApp>,
    name: string,
  ) => {
    const bytes = new TextEncoder().encode(name);
    const initiatedResponse = await app.request("/api/objects", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        contentType: "text/plain",
        size: bytes.byteLength,
      }),
    });
    const initiated = (await initiatedResponse.json()) as {
      object: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };
    await loopback(app, initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: bytes,
    });
    await app.request(`/api/objects/${initiated.object.id}/confirm`, {
      method: "POST",
      headers: auth,
    });
    return initiated.object.id;
  };

  it("batch delete removes every valid id and is idempotent for unknown ones", async () => {
    const app = makeApp();
    const a = await makeReadyObject(app, "a.txt");
    const b = await makeReadyObject(app, "b.txt");
    const unknown = "00000000-0000-0000-0000-000000000000";

    const response = await app.request("/api/objects/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [a, b, unknown] }),
    });
    expect(response.status).toBe(200);
    // A missing object is a no-op delete, so it lands in `deleted`, not `failed`.
    const body = (await response.json()) as {
      deleted: string[];
      failed: { id: string }[];
    };
    expect(body.deleted.sort()).toEqual([a, b, unknown].sort());
    expect(body.failed).toEqual([]);

    // Both real objects are actually gone.
    for (const id of [a, b]) {
      const gone = await app.request(`/api/objects/${id}`, {
        method: "GET",
        headers: auth,
      });
      expect(gone.status).toBe(404);
    }
  });

  it("rejects an empty batch delete with a typed ValidationError (400)", async () => {
    const app = makeApp();
    const response = await app.request("/api/objects/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("returns a typed NotFound (404) for an unknown id", async () => {
    const app = makeApp();
    const response = await app.request(
      "/api/objects/00000000-0000-0000-0000-000000000000",
      { method: "GET", headers: auth },
    );
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
    // gt with a boolean operand is rejected at schema-decode time
    const response = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ where: [{ key: "x", op: "gt", value: true }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });
});
