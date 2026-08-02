import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { ShareGrantStore } from "./shares.js";
import { testSql } from "./test/db.js";
import { s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const TOKEN = "secret-token";

const sql = testSql();
let mock: S3Mock;
beforeAll(async () => {
  mock = await startS3Mock();
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await mock.close();
});

const makeApp = () =>
  createApp({
    layer: Layer.mergeAll(
      Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
      S3BlobStoreLive(s3MockConfig(mock)),
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

const putToStorage = (uploadUrl: string, init?: RequestInit) => fetch(uploadUrl, init);

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

    const uploaded = await putToStorage(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
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
        where: [{ key: "tags", op: "has_value", value: "brown" }],
        offset: 0,
      }),
    });
    expect(queried.status).toBe(200);
    const queryBody = (await queried.json()) as { items: { id: string }[]; totalCount: number };
    expect(queryBody.items.map((o) => o.id)).toContain(initiated.item.id);
    expect(queryBody.totalCount).toBe(1);

    const contentResponse = await app.request(`/api/items/${initiated.item.id}/content`, {
      method: "GET",
      headers: auth,
    });
    expect(contentResponse.status).toBe(200);
    const { url } = (await contentResponse.json()) as { url: string };
    // Downloads are presigned GETs served directly by storage (the mock).
    const downloaded = await fetch(url);
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
    await putToStorage(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: bytes,
    });
    await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: auth,
    });
    return initiated.item.id;
  };

  it("uploads and serves a video thumbnail", async () => {
    const app = makeApp();
    const video = new TextEncoder().encode("video bytes");
    const initiatedResponse = await app.request("/api/items", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "clip.mp4",
        contentType: "video/mp4",
        size: video.byteLength,
      }),
    });
    const initiated = (await initiatedResponse.json()) as {
      item: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };
    await putToStorage(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: video,
    });
    await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: auth,
    });

    const absent = await app.request(`/api/items/${initiated.item.id}/thumbnail`, {
      headers: auth,
    });
    expect(absent.status).toBe(404);

    const invalid = await app.request(`/api/items/${initiated.item.id}/thumbnail`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/gif", size: 4 }),
    });
    expect(invalid.status).toBe(400);

    const thumbnail = new Uint8Array([1, 2, 3, 4]);
    const uploadResponse = await app.request(`/api/items/${initiated.item.id}/thumbnail`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/webp", size: thumbnail.byteLength }),
    });
    expect(uploadResponse.status).toBe(200);
    const upload = (await uploadResponse.json()) as {
      url: string;
      headers: Record<string, string>;
    };
    expect(
      await putToStorage(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: thumbnail,
      }),
    ).toMatchObject({ status: 200 });

    const downloadResponse = await app.request(`/api/items/${initiated.item.id}/thumbnail`, {
      headers: auth,
    });
    expect(downloadResponse.status).toBe(200);
    const download = (await downloadResponse.json()) as { url: string };
    expect(new Uint8Array(await (await fetch(download.url)).arrayBuffer())).toEqual(thumbnail);

    expect(
      await app.request(`/api/items/${initiated.item.id}/thumbnail`, {
        method: "DELETE",
        headers: auth,
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await app.request(`/api/items/${initiated.item.id}/thumbnail`, { headers: auth }),
    ).toMatchObject({ status: 404 });
  });

  it("lists, restores, and permanently purges trashed ready items", async () => {
    const app = makeApp();
    const id = await makeReadyItem(app, "trash-roundtrip.txt");
    const usageBefore = (await (await app.request("/api/usage", { headers: auth })).json()) as {
      accountedItems: number;
    };

    expect(
      (await app.request(`/api/items/${id}`, { method: "DELETE", headers: auth })).status,
    ).toBe(200);
    expect((await app.request(`/api/items/${id}`, { headers: auth })).status).toBe(404);
    expect(
      (
        (await (
          await app.request("/api/query", {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ where: [] }),
          })
        ).json()) as { items: { id: string }[] }
      ).items.some((item) => item.id === id),
    ).toBe(false);

    const trash = (await (await app.request("/api/trash", { headers: auth })).json()) as {
      items: { id: string; deletedAt: string }[];
    };
    expect(trash.items.find((item) => item.id === id)?.deletedAt).toMatch(/Z$/);

    const trashedItemResponse = await app.request(`/api/trash/${id}`, { headers: auth });
    expect(trashedItemResponse.status).toBe(200);
    expect(await trashedItemResponse.json()).toMatchObject({ id, name: "trash-roundtrip.txt" });

    const trashedContentResponse = await app.request(`/api/trash/${id}/content`, { headers: auth });
    expect(trashedContentResponse.status).toBe(200);
    const trashedContent = (await trashedContentResponse.json()) as { url: string };
    expect(await (await fetch(trashedContent.url)).text()).toBe("trash-roundtrip.txt");

    const usageTrashed = (await (await app.request("/api/usage", { headers: auth })).json()) as {
      accountedItems: number;
    };
    expect(usageTrashed.accountedItems).toBe(usageBefore.accountedItems);

    const restored = await app.request(`/api/trash/${id}/restore`, {
      method: "POST",
      headers: auth,
    });
    expect(restored.status).toBe(200);
    expect((await restored.json()) as { id: string }).toMatchObject({ id });
    expect((await app.request(`/api/items/${id}/content`, { headers: auth })).status).toBe(200);

    await app.request(`/api/items/${id}`, { method: "DELETE", headers: auth });
    expect(
      (await app.request(`/api/trash/${id}`, { method: "DELETE", headers: auth })).status,
    ).toBe(200);
    expect(
      (
        (await (await app.request("/api/trash", { headers: auth })).json()) as {
          items: { id: string }[];
        }
      ).items.some((item) => item.id === id),
    ).toBe(false);
    const usagePurged = (await (await app.request("/api/usage", { headers: auth })).json()) as {
      accountedItems: number;
    };
    expect(usagePurged.accountedItems).toBe(usageBefore.accountedItems - 1);
  });

  it("batch restores and permanently purges trash", async () => {
    const app = makeApp();
    const restoredId = await makeReadyItem(app, "batch-restore.txt");
    const purgedId = await makeReadyItem(app, "batch-purge.txt");
    await app.request("/api/items/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [restoredId, purgedId] }),
    });

    const restored = await app.request("/api/trash/restore", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [restoredId] }),
    });
    expect(await restored.json()).toMatchObject({ restored: [restoredId], failed: [] });
    const purged = await app.request("/api/trash/delete", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ids: [purgedId] }),
    });
    expect(await purged.json()).toMatchObject({ deleted: [purgedId], failed: [] });
    expect((await app.request(`/api/items/${restoredId}`, { headers: auth })).status).toBe(200);
    expect((await app.request(`/api/items/${purgedId}`, { headers: auth })).status).toBe(404);
  });

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

  it("bulk patches valid items and reports per-item revision and missing failures", async () => {
    const app = makeApp();
    const a = await makeReadyItem(app, "bulk-a.txt");
    const b = await makeReadyItem(app, "bulk-b.txt");
    const unknown = "00000000-0000-4000-8000-000000000099";
    const currentA = (await (await app.request(`/api/items/${a}`, { headers: auth })).json()) as {
      revision: number;
    };
    const currentB = (await (await app.request(`/api/items/${b}`, { headers: auth })).json()) as {
      revision: number;
    };

    const response = await app.request("/api/items/patch", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: a, expectedRevision: currentA.revision },
          { id: b, expectedRevision: currentB.revision + 1 },
          { id: unknown },
        ],
        set: { reviewed: null, project: "bulk" },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      updated: { id: string; revision: number }[];
      failed: { id: string; error: { _tag: string } }[];
    };
    expect(body.updated).toEqual([{ id: a, revision: currentA.revision + 1 }]);
    expect(body.failed).toEqual([
      { id: b, error: { _tag: "Conflict", message: "Item revision changed" } },
      { id: unknown, error: { _tag: "NotFound", message: "Item not found" } },
    ]);

    const patchedA = await (await app.request(`/api/items/${a}`, { headers: auth })).json();
    const unchangedB = await (await app.request(`/api/items/${b}`, { headers: auth })).json();
    expect(patchedA).toMatchObject({ properties: { reviewed: null, project: "bulk" } });
    expect(unchangedB).toMatchObject({ properties: {} });
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
