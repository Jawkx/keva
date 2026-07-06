import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "@keva/core";
import type { CreateShareGrantResult } from "@keva/schema";
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
  const tokens = Layer.succeed(ApiTokenStore, emptyTokenStore);
  const shares = Layer.succeed(ShareGrantStore, makeInMemoryShareGrantStore());
  const auth = TokenAndStaticAuthFromStoreLive({
    staticToken: STATIC,
    tenantId: TENANT,
    sessionResolver,
  }).pipe(Layer.provide(Layer.merge(tokens, shares)));
  return createApp({
    layer: Layer.mergeAll(MemoryMetadataStoreLive, MemoryBlobStoreLive(), tokens, shares, auth),
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

const createShare = async (app: ReturnType<typeof makeApp>, body: object) => {
  const response = await app.request("/api/shares", {
    method: "POST",
    headers: admin,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as CreateShareGrantResult };
};

const readWriteGrant = {
  name: "Alpha share",
  scopes: ["read", "write"],
  conditions: [{ key: "project", op: "eq", value: "alpha" }],
  writeStamp: { project: "alpha" },
};

describe("server share subsystem", () => {
  it("rejects share management without an admin session", async () => {
    const app = makeApp();
    const response = await app.request("/api/shares", {
      method: "POST",
      headers: staticAuth,
      body: JSON.stringify(readWriteGrant),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ _tag: "Forbidden" });
  });

  it("scopes reads to the grant conditions and redacts internal fields", async () => {
    const app = makeApp();
    await seedItem(app, "in.txt", { project: "alpha" });
    await seedItem(app, "out.txt", { project: "beta" });
    const { status, body } = await createShare(app, readWriteGrant);
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
    // Redaction: no tenant-internal fields anywhere in the share response.
    const serialized = JSON.stringify(items[0]);
    for (const field of ["tenantId", "storageKey", "stagingKey"]) {
      expect(serialized).not.toContain(field);
    }
  });

  it("stamps share uploads and reports them back through the grant", async () => {
    const app = makeApp();
    const { body } = await createShare(app, readWriteGrant);
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
    const { body } = await createShare(app, readWriteGrant);
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
    const { body } = await createShare(app, readWriteGrant);
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
    const { body } = await createShare(app, {
      ...readWriteGrant,
      maxItems: 5,
      maxTotalBytes: 1000,
    });
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
    const { body } = await createShare(app, {
      name: "Read only",
      scopes: ["read"],
      conditions: [{ key: "project", op: "eq", value: "alpha" }],
    });
    const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
    expect(await response.json()).toMatchObject({ scopes: ["read"], upload: null });
  });

  it("enforces the item-count quota", async () => {
    const app = makeApp();
    const { body } = await createShare(app, { ...readWriteGrant, maxItems: 1 });
    const token = body.token;
    // First initiate consumes the single allowed slot (pending counts).
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
    const { body } = await createShare(app, readWriteGrant);
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
    const { body } = await createShare(app, {
      ...readWriteGrant,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
    expect(response.status).toBe(401);
  });
});
