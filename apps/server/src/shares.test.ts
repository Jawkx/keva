import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import type { CreateShareGrantResult, QueryCondition, Scope, ViewRecord } from "@keva/schema";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  ApiTokenStore,
  type ApiTokenStoreService,
  TokenAndStaticAuthFromStoreLive,
} from "./auth.js";
import { ShareGrantStore } from "./shares.js";
import { testSql } from "./test/db.js";
import { s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";
import { makeInMemoryShareGrantStore } from "./test/share-store.js";
import { makeInMemoryViewStore } from "./test/view-store.js";
import { ViewStore } from "./views.js";

const STATIC = "static-token";
const SCOPED_TOKEN = "keva_sk_scoped_token";
const TENANT = "acme";
const ADMIN_COOKIE = "keva_session=admin";
const RECIPIENT_COOKIE = "keva_session=recipient";
const OTHER_COOKIE = "keva_session=other";
const USERS = [
  { id: "owner-user", name: "Owner", email: "owner@example.com" },
  { id: "recipient-user", name: "Recipient", email: "recipient@example.com" },
  { id: "other-user", name: "Other", email: "other@example.com" },
] as const;

const sql = testSql();
let mock: S3Mock;
beforeAll(async () => {
  mock = await startS3Mock();
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await mock.close();
});

const emptyTokenStore: ApiTokenStoreService = {
  resolve: () => Effect.succeed(null),
  mint: () => Effect.die("not used"),
  list: () => Effect.succeed([]),
  revoke: () => Effect.succeed(false),
};

const sessionResolver = async (headers: Headers) =>
  headers.get("cookie")?.includes(ADMIN_COOKIE)
    ? {
        tenantId: TENANT,
        scopes: ["read", "write", "delete", "admin"] as const,
        user: { id: USERS[0].id, name: USERS[0].name },
      }
    : headers.get("cookie")?.includes(RECIPIENT_COOKIE)
      ? {
          tenantId: "recipient-tenant",
          scopes: ["read", "write", "delete", "admin"] as const,
          user: { id: USERS[1].id, name: USERS[1].name },
        }
      : headers.get("cookie")?.includes(OTHER_COOKIE)
        ? {
            tenantId: "other-tenant",
            scopes: ["read", "write", "delete", "admin"] as const,
            user: { id: USERS[2].id, name: USERS[2].name },
          }
        : null;

const makeApp = (scopedTokenScopes?: ReadonlyArray<Scope>) => {
  const views = new Map<string, ViewRecord>();
  const tokens = Layer.succeed(ApiTokenStore, {
    ...emptyTokenStore,
    resolve: (token: string) =>
      Effect.succeed(
        token === SCOPED_TOKEN && scopedTokenScopes
          ? { tenantId: TENANT, scopes: [...scopedTokenScopes], via: "token" as const }
          : null,
      ),
  });
  const shares = Layer.succeed(ShareGrantStore, makeInMemoryShareGrantStore(views, USERS));
  const viewsLayer = Layer.succeed(ViewStore, makeInMemoryViewStore(views));
  const auth = TokenAndStaticAuthFromStoreLive({
    staticToken: STATIC,
    tenantId: TENANT,
    sessionResolver,
  }).pipe(Layer.provide(Layer.merge(tokens, shares)));
  return createApp({
    layer: Layer.mergeAll(
      Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
      S3BlobStoreLive(s3MockConfig(mock)),
      tokens,
      shares,
      viewsLayer,
      auth,
    ),
    userAvatars: async (userIds) =>
      new Map(
        userIds.map((id) => [
          id,
          { version: 1 as const, seed: `current-${id}`, glasses: "variant01" as const },
        ]),
      ),
  });
};

const admin = { cookie: ADMIN_COOKIE, "content-type": "application/json" };
const staticAuth = { authorization: `Bearer ${STATIC}`, "content-type": "application/json" };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const scopedAuth = {
  authorization: `Bearer ${SCOPED_TOKEN}`,
  "content-type": "application/json",
};

const putToStorage = (uploadUrl: string, init?: RequestInit) => fetch(uploadUrl, init);

const seedItem = async (app: ReturnType<typeof makeApp>, name: string, properties: object) => {
  const bytes = new TextEncoder().encode(name);
  const initiated = (await (
    await app.request("/api/items", {
      method: "POST",
      headers: staticAuth,
      body: JSON.stringify({ name, contentType: "text/plain", size: bytes.byteLength }),
    })
  ).json()) as { item: { id: string }; uploadUrl: string; headers: Record<string, string> };
  await putToStorage(initiated.uploadUrl, {
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

const ALPHA: QueryCondition[] = [{ key: "project", op: "has_value", value: "alpha" }];

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
  it("ignores expired write grants when validating a view update", async () => {
    const now = new Date().toISOString();
    const views = new Map<string, ViewRecord>([
      [
        "view-1",
        {
          id: "view-1",
          tenantId: TENANT,
          name: "View",
          icon: null,
          conditions: ALPHA,
          createdAt: now,
          updatedAt: now,
        },
      ],
    ]);
    const store = makeInMemoryShareGrantStore(views);
    await Effect.runPromise(
      store.create(TENANT, {
        name: "Expired",
        viewId: "view-1",
        scopes: ["write"],
        writeStamp: { project: "alpha" },
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    await expect(
      Effect.runPromise(
        store.updateView({ tenantId: TENANT, scopes: ["admin"], via: "session" }, "view-1", {
          conditions: [{ key: "project", op: "has_value", value: "beta" }],
        }),
      ),
    ).resolves.toMatchObject({ conditions: [{ value: "beta" }] });
  });

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

  it("creates an inline backing view and its share as one command", async () => {
    const app = makeApp();
    const { status, body } = await createShare(app, {
      name: "Inline share",
      scopes: ["read"],
      view: { name: "Inline view", conditions: ALPHA },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      record: { name: "Inline share", conditions: ALPHA },
      view: { name: "Inline view", conditions: ALPHA },
    });
    expect(body.record.viewId).toBe(body.view.id);
  });

  it("does not retain an inline view when share validation fails", async () => {
    const app = makeApp();
    const { status } = await createShare(app, {
      name: "Invalid inline share",
      scopes: ["read", "write"],
      writeStamp: { project: "beta" },
      view: { name: "Orphan candidate", conditions: ALPHA },
    });
    expect(status).toBe(400);

    const response = await app.request("/api/views", { headers: admin });
    expect(await response.json()).toEqual([]);
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

  it("requires read or write authority matching the share being created", async () => {
    const sharesOnly = makeApp(["shares"]);
    const readAttempt = await sharesOnly.request("/api/shares", {
      method: "POST",
      headers: scopedAuth,
      body: JSON.stringify({
        name: "Download",
        view: { name: "All", conditions: [] },
        scopes: ["read"],
      }),
    });
    expect(readAttempt.status).toBe(403);

    const readAndShares = makeApp(["shares", "read"]);
    const allowed = await readAndShares.request("/api/shares", {
      method: "POST",
      headers: scopedAuth,
      body: JSON.stringify({
        name: "Download",
        view: { name: "All", conditions: [] },
        scopes: ["read"],
      }),
    });
    expect(allowed.status).toBe(200);

    const writeAttempt = await readAndShares.request("/api/shares", {
      method: "POST",
      headers: scopedAuth,
      body: JSON.stringify({
        name: "Upload",
        view: { name: "All uploads", conditions: [] },
        scopes: ["write"],
        writeStamp: {},
      }),
    });
    expect(writeAttempt.status).toBe(403);
  });

  it("does not return share secrets from list operations", async () => {
    const app = makeApp();
    const { body } = await shareAlpha(app);
    expect(body.token).toMatch(/^keva_sh_/);
    expect(body.record).not.toHaveProperty("token");

    const listed = await app.request("/api/shares", { headers: admin });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as unknown[]).toEqual([
      expect.not.objectContaining({ token: expect.anything() }),
    ]);
  });

  it("requires shares and delegated content scopes to edit a shared view", async () => {
    const app = makeApp(["views"]);
    const { view } = await createView(app, ALPHA);
    await createShare(app, { name: "Download", viewId: view.id, scopes: ["read"] });

    const viewsOnly = await app.request(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: scopedAuth,
      body: JSON.stringify({ conditions: [] }),
    });
    expect(viewsOnly.status).toBe(403);

    const fullyScoped = makeApp(["views", "shares", "read"]);
    const created = await createView(fullyScoped, ALPHA);
    await createShare(fullyScoped, {
      name: "Download",
      viewId: created.view.id,
      scopes: ["read"],
    });
    const allowed = await fullyScoped.request(`/api/views/${created.view.id}`, {
      method: "PATCH",
      headers: scopedAuth,
      body: JSON.stringify({ conditions: [] }),
    });
    expect(allowed.status).toBe(200);
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
      body: JSON.stringify({
        conditions: [{ key: "project", op: "has_value", value: "beta" }],
      }),
    });
    expect(patched.status).toBe(200);
    expect(await namesVia()).toEqual(["later.txt"]);
  });

  it("rejects a view edit that would invalidate an active write grant", async () => {
    const app = makeApp();
    const { view } = await createView(app, ALPHA);
    const { body } = await createShare(app, {
      name: "Alpha share",
      viewId: view.id,
      scopes: ["read", "write"],
      writeStamp: { project: "alpha" },
    });
    const updated = await app.request(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({
        conditions: [{ key: "project", op: "has_value", value: "beta" }],
      }),
    });
    expect(updated.status).toBe(409);
    expect(await updated.json()).toMatchObject({
      _tag: "Conflict",
      grantIds: [body.record.id],
    });
    const current = await app.request(`/api/views/${view.id}`, { headers: admin });
    expect((await current.json()) as ViewRecord).toMatchObject({ conditions: ALPHA });
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

    await putToStorage(initiated.uploadUrl, {
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
    vi.useFakeTimers();
    const now = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);
    try {
      const app = makeApp();
      const { status, body } = await shareAlpha(app, {
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      });
      expect(status).toBe(200);

      vi.setSystemTime(new Date(now.getTime() + 120_000));
      const response = await app.request("/api/shares/self", { headers: bearer(body.token) });
      expect(response.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds an accepted shared view to the recipient account and owner tenant", async () => {
    const app = makeApp();
    const { view } = await createView(app, ALPHA, "Client drop");
    const invited = await app.request("/api/account-shares", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        recipientEmail: USERS[1].email,
        viewId: view.id,
        scopes: ["read", "write"],
        writeStamp: { project: "alpha" },
      }),
    });
    expect(invited.status).toBe(200);
    const grant = (await invited.json()) as { id: string };

    const legacyRevoke = await app.request(`/api/shares/${grant.id}`, {
      method: "DELETE",
      headers: { cookie: ADMIN_COOKIE },
    });
    expect(await legacyRevoke.json()).toEqual({ revoked: false });

    const pending = await app.request("/api/shared-views", {
      headers: { cookie: RECIPIENT_COOKIE },
    });
    expect(await pending.json()).toMatchObject([
      {
        id: grant.id,
        status: "pending",
        name: "Client drop",
        owner: {
          name: "Owner",
          avatar: { version: 1, seed: USERS[0].id },
        },
      },
    ]);

    const pendingAccess = await app.request(`/api/shared-views/${grant.id}/query`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(pendingAccess.status).toBe(404);

    const wrongRecipient = await app.request(`/api/shared-views/${grant.id}/accept`, {
      method: "POST",
      headers: { cookie: OTHER_COOKIE },
    });
    expect(wrongRecipient.status).toBe(404);

    const accepted = await app.request(`/api/shared-views/${grant.id}/accept`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ status: "accepted" });
    const acceptedAgain = await app.request(`/api/shared-views/${grant.id}/accept`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE },
    });
    expect(acceptedAgain.status).toBe(200);
    expect(await acceptedAgain.json()).toMatchObject({ status: "accepted" });

    const propertyOverride = await app.request(`/api/shared-views/${grant.id}/items`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE, "content-type": "application/json" },
      body: JSON.stringify({
        name: "override.txt",
        contentType: "text/plain",
        size: 1,
        properties: { project: "beta" },
      }),
    });
    expect(propertyOverride.status).toBe(400);

    const initiatedResponse = await app.request(`/api/shared-views/${grant.id}/items`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE, "content-type": "application/json" },
      body: JSON.stringify({ name: "delivery.txt", contentType: "text/plain", size: 1 }),
    });
    expect(initiatedResponse.status).toBe(200);
    const initiated = (await initiatedResponse.json()) as {
      item: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };
    await putToStorage(initiated.uploadUrl, {
      method: "PUT",
      headers: initiated.headers,
      body: "x",
    });
    const confirmed = await app.request(
      `/api/shared-views/${grant.id}/items/${initiated.item.id}/confirm`,
      { method: "POST", headers: { cookie: RECIPIENT_COOKIE } },
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ properties: { project: "alpha" } });

    const ownerItem = await app.request(`/api/items/${initiated.item.id}`, {
      headers: bearer(STATIC),
    });
    expect(ownerItem.status).toBe(200);
    expect(await ownerItem.json()).toMatchObject({
      source: `share:${grant.id}`,
      properties: { project: "alpha" },
    });

    const activity = await app.request(`/api/items/${initiated.item.id}/events`, {
      headers: bearer(STATIC),
    });
    expect(await activity.json()).toMatchObject({
      events: [
        {
          actor: {
            user: {
              id: USERS[1].id,
              name: USERS[1].name,
              avatar: {
                version: 1,
                seed: `current-${USERS[1].id}`,
                glasses: "variant01",
              },
            },
            share: { grantId: grant.id, name: "Client drop" },
          },
        },
      ],
    });

    const queried = await app.request(`/api/shared-views/${grant.id}/query`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE, "content-type": "application/json" },
      body: JSON.stringify({ offset: 0 }),
    });
    expect(await queried.json()).toMatchObject({
      items: [{ id: initiated.item.id }],
      totalCount: 1,
    });

    const revoked = await app.request(`/api/account-shares/${grant.id}`, {
      method: "DELETE",
      headers: { cookie: ADMIN_COOKIE },
    });
    expect(await revoked.json()).toEqual({ revoked: true });
    const afterRevoke = await app.request(`/api/shared-views/${grant.id}/query`, {
      method: "POST",
      headers: { cookie: RECIPIENT_COOKIE, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(afterRevoke.status).toBe(404);
  });
});
