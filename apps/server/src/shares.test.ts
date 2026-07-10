import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import type { CreateShareGrantResult, QueryCondition, ViewRecord } from "@keva/schema";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  ApiTokenStore,
  type ApiTokenStoreService,
  TokenAndStaticAuthFromStoreLive,
} from "./auth.js";
import { ShareGrantStore } from "./shares.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const STATIC = "static-token";
const TENANT = "acme";
const ADMIN_COOKIE = "keva_session=admin";

const emptyTokenStore: ApiTokenStoreService = {
  resolve: () => Effect.succeed(null),
  mint: () => Effect.die("not used"),
  list: () => Effect.succeed([]),
  revoke: () => Effect.succeed(false),
};

const sessionResolver = async (headers: Headers) =>
  headers.get("cookie")?.includes(ADMIN_COOKIE)
    ? { tenantId: TENANT, scopes: ["read", "write", "delete", "admin"] as const }
    : null;

const makeApp = () => {
  const views = new Map<string, ViewRecord>();
  const tokens = Layer.succeed(ApiTokenStore, emptyTokenStore);
  const shares = Layer.succeed(ShareGrantStore, makeInMemoryShareGrantStore(views));
  const viewsLayer = Layer.succeed(ViewStore, makeInMemoryViewStore(views));
  const auth = TokenAndStaticAuthFromStoreLive({
    staticToken: STATIC,
    tenantId: TENANT,
    sessionResolver,
  }).pipe(Layer.provide(Layer.merge(tokens, shares)));
  return createApp({
    layer: Layer.mergeAll(
      MemoryMetadataStoreLive,
      MemoryBlobStoreLive(),
      tokens,
      shares,
      viewsLayer,
      auth,
    ),
  });
};

const admin = { cookie: ADMIN_COOKIE, "content-type": "application/json" };
const staticAuth = { authorization: `Bearer ${STATIC}`, "content-type": "application/json" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const loopback = (app: ReturnType<typeof makeApp>, absoluteUrl: string, init?: RequestInit) => {
  const url = new URL(absoluteUrl);
  return app.request(`${url.pathname}${url.search}`, init);
};

const seedItem = async (app: ReturnType<typeof makeApp>, name: string, properties: object) => {
  const bytes = new TextEncoder().encode(name);
  const initiated = (await (
    await app.request("/api/items", {
      method: "POST",
      headers: staticAuth,
      body: JSON.stringify({ name, contentType: "text/plain", size: bytes.byteLength }),
    })
  ).json()) as { item: { id: string }; uploadUrl: string; headers: Record<string, string> };
  await loopback(app, initiated.uploadUrl, {
    method: "PUT",
    headers: initiated.headers,
    body: bytes,
  });
  await app.request(`/api/items/${initiated.item.id}/confirm`, {
    method: "POST",
    headers: bearer(STATIC),
  });
  await app.request(`/api/items/${initiated.item.id}`, {
    method: "PATCH",
    headers: staticAuth,
    body: JSON.stringify({ set: properties }),
  });
  return initiated.item.id;
};

const createView = async (
  app: ReturnType<typeof makeApp>,
  conditions: QueryCondition[],
  name = "Alpha view",
) => {
  const response = await app.request("/api/views", {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ name, conditions }),
  });
  return { status: response.status, view: (await response.json()) as ViewRecord };
};

const createShare = async (app: ReturnType<typeof makeApp>, body: object) => {
  const response = await app.request("/api/shares", {
    method: "POST",
    headers: admin,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as CreateShareGrantResult };
};

const ALPHA: QueryCondition[] = [{ key: "project", op: "eq", value: "alpha" }];

const shareAlpha = async (app: ReturnType<typeof makeApp>, overrides: object = {}) => {
  const { view } = await createView(app, ALPHA);
  return createShare(app, {
    name: "Alpha share",
    viewId: view.id,
    scopes: ["read", "write"],
    writeStamp: { project: "alpha" },
    ...overrides,
  });
};

describe("server share subsystem", () => {
  it("rejects share management without an admin session", async () => {
    const app = makeApp();
    const response = await app.request("/api/shares", {
      method: "POST",
      headers: staticAuth,
      body: JSON.stringify({ name: "x", viewId: "v", scopes: ["read"] }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ _tag: "Forbidden" });
  });

  it("rejects a grant referencing a missing view", async () => {
    const app = makeApp();
    const { status, body } = await createShare(app, {
      name: "Bad",
      viewId: "nope",
      scopes: ["read"],
    });
    expect(status).toBe(404);
    expect(body).toMatchObject({ _tag: "NotFound" });
  });

  it("rejects a write grant whose view conditions aren't plain property keys", async () => {
    const app = makeApp();
    const { view } = await createView(app, [{ key: "system.size", op: "gt", value: 0 }]);
    const response = await app.request("/api/shares", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        name: "Bad write",
        viewId: view.id,
        scopes: ["read", "write"],
        writeStamp: { project: "alpha" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("rejects a writeStamp that doesn't satisfy the view conditions", async () => {
    const app = makeApp();
    const { view } = await createView(app, ALPHA);
    const response = await app.request("/api/shares", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        name: "Bad stamp",
        viewId: view.id,
        scopes: ["read", "write"],
        writeStamp: { project: "beta" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("scopes reads to the view conditions and redacts internal fields", async () => {
    const app = makeApp();
    await seedItem(app, "in.txt", { project: "alpha" });
    await seedItem(app, "out.txt", { project: "beta" });
    const { status, body } = await shareAlpha(app);
    expect(status).toBe(200);
    expect(body.token).toMatch(/^keva_sh_/);

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...bearer(body.token), "content-type": "application/json" },
      body: JSON.stringify({ where: [] }),
    });
    expect(queried.status).toBe(200);
    const items = ((await queried.json()) as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("in.txt");
    const serialized = JSON.stringify(items[0]);
    for (const field of ["tenantId", "storageKey", "stagingKey"]) {
      expect(serialized).not.toContain(field);
    }
  });

  it("reflects a live view edit in the share's visible items", async () => {
    const app = makeApp();
    await seedItem(app, "in.txt", { project: "alpha" });
    await seedItem(app, "later.txt", { project: "beta" });
    const { view } = await createView(app, ALPHA);
    const { body } = await createShare(app, {
      name: "Alpha share",
      viewId: view.id,
      scopes: ["read"],
    });

    const namesVia = async () => {
      const res = await app.request("/api/query", {
        method: "POST",
        headers: { ...bearer(body.token), "content-type": "application/json" },
        body: JSON.stringify({ where: [] }),
      });
      return ((await res.json()) as { items: { name: string }[] }).items.map((i) => i.name).sort();
    };

    expect(await namesVia()).toEqual(["in.txt"]);

    const patched = await app.request(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({ conditions: [{ key: "project", op: "eq", value: "beta" }] }),
    });
    expect(patched.status).toBe(200);
    expect(await namesVia()).toEqual(["later.txt"]);
  });

  it("stamps share uploads and reports them back through the grant", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app);
    const token = body.token;
    const bytes = new TextEncoder().encode("dropped");

    const initiated = (await (
      await app.request("/api/items", {
        method: "POST",
        headers: { ...bearer(token), "content-type": "application/json" },
        body: JSON.stringify({
          name: "drop.txt",
          contentType: "text/plain",
          size: bytes.byteLength,
        }),
      })
    ).json()) as {
      item: { id: string; source?: string; tenantId?: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };
    expect(initiated.item.tenantId).toBeUndefined();

    await loopback(app, initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: bytes,
    });
    const confirmed = await app.request(`/api/items/${initiated.item.id}/confirm`, {
      method: "POST",
      headers: bearer(token),
    });
    expect(confirmed.status).toBe(200);
    const confirmedItem = (await confirmed.json()) as { source: string; properties: object };
    expect(confirmedItem.source).toBe(`share:${body.record.id}`);
    expect(confirmedItem.properties).toEqual({ project: "alpha" });

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ where: [] }),
    });
    const names = ((await queried.json()) as { items: { name: string }[] }).items.map(
      (i) => i.name,
    );
    expect(names).toContain("drop.txt");
  });

  it("rejects caller-supplied properties on a share upload", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app);
    const response = await app.request("/api/items", {
      method: "POST",
      headers: { ...bearer(body.token), "content-type": "application/json" },
      body: JSON.stringify({
        name: "x.txt",
        contentType: "text/plain",
        size: 1,
        properties: { project: "beta" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ _tag: "ValidationError" });
  });

  it("forbids mutation, usage, and autocomplete routes for share tokens", async () => {
    const app = makeApp();
    const id = await seedItem(app, "in.txt", { project: "alpha" });
    const { body } = await shareAlpha(app);
    const token = body.token;

    const patch = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ set: { project: "beta" } }),
    });
    expect(patch.status).toBe(403);

    const del = await app.request(`/api/items/${id}`, { method: "DELETE", headers: bearer(token) });
    expect(del.status).toBe(403);

    const usage = await app.request("/api/usage", { headers: bearer(token) });
    expect(usage.status).toBe(403);

    const keys = await app.request("/api/properties/keys", { headers: bearer(token) });
    expect(keys.status).toBe(403);

    const manage = await app.request("/api/shares", { headers: bearer(token) });
    expect(manage.status).toBe(403);
  });

  it("describes itself via /api/shares/self including upload usage", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app, { maxItems: 5, maxTotalBytes: 1000 });
    const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Alpha share",
      scopes: ["read", "write"],
      upload: { maxItems: 5, maxTotalBytes: 1000, usedItems: 0, usedBytes: 0 },
    });
  });

  it("returns null upload block for a read-only share", async () => {
    const app = makeApp();
    const { view } = await createView(app, ALPHA);
    const { body } = await createShare(app, {
      name: "Read only",
      viewId: view.id,
      scopes: ["read"],
    });
    const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
    expect(await response.json()).toMatchObject({ scopes: ["read"], upload: null });
  });

  it("enforces the item-count quota", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app, { maxItems: 1 });
    const token = body.token;
    await app.request("/api/items", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ name: "one.txt", contentType: "text/plain", size: 1 }),
    });
    const second = await app.request("/api/items", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ name: "two.txt", contentType: "text/plain", size: 1 }),
    });
    expect(second.status).toBe(413);
    expect(await second.json()).toMatchObject({ _tag: "QuotaExceeded" });
  });

  it("revokes a share; the token and /self stop working", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app);
    const token = body.token;

    const revoked = await app.request(`/api/shares/${body.record.id}`, {
      method: "DELETE",
      headers: { cookie: ADMIN_COOKIE },
    });
    expect(await revoked.json()).toMatchObject({ revoked: true });

    const afterSelf = await app.request("/api/shares/self", { headers: bearer(token) });
    expect(afterSelf.status).toBe(401);
    const afterQuery = await app.request("/api/query", {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify({ where: [] }),
    });
    expect(afterQuery.status).toBe(401);
  });

  it("rejects an expired share token", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
    expect(response.status).toBe(401);
  });
});
