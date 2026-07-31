import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import {
  isShareToken,
  KevaClient,
  KevaProtocolError,
  ShareClient,
  SharedViewClient,
  shareClient,
} from "./index.js";

describe("KevaClient", () => {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant",
    name: "hello.txt",
    contentType: "text/plain",
    declaredSize: 5,
    size: 5,
    etag: "etag",
    source: "upload",
    status: "ready" as const,
    revision: 1,
    storageKey: "items/tenant/id",
    stagingKey: "staging/tenant/id",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    properties: {},
  };

  it("throws the shared typed error contract", async () => {
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      token: "test",
      fetch: async () =>
        Response.json({ _tag: "NotFound", message: "Item not found" }, { status: 404 }),
    });

    await expect(client.get("missing")).rejects.toMatchObject({
      _tag: "NotFound",
      message: "Item not found",
    });

    const unauthorized = new KevaClient({
      baseUrl: "https://keva.invalid",
      token: "bad",
      fetch: async () =>
        Response.json({ _tag: "Unauthorized", message: "Invalid credential" }, { status: 401 }),
    });
    await expect(unauthorized.query()).rejects.toMatchObject({
      _tag: "Unauthorized",
    });
  });

  it("rejects malformed success responses", async () => {
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      token: "test",
      fetch: async () => Response.json({ unexpected: true }),
    });

    await expect(client.get("bad")).rejects.toBeInstanceOf(KevaProtocolError);
  });

  it("sends offset pagination and decodes the total count", async () => {
    let body: unknown;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ items: [item], totalCount: 7 });
      },
    });

    await expect(
      client.query({ where: [], limit: 2, offset: 4, order: "created_at_desc" }),
    ).resolves.toMatchObject({ totalCount: 7 });
    expect(body).toMatchObject({ offset: 4 });
  });

  it("requests and decodes property suggestions", async () => {
    let requestedUrl = "";
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input) => {
        requestedUrl = String(input);
        return Response.json({ entries: [{ key: "department", value: "Finance" }] });
      },
    });

    await expect(client.propertySuggestions("fin & ops")).resolves.toEqual([
      { key: "department", value: "Finance" },
    ]);
    expect(requestedUrl).toBe("https://keva.invalid/api/properties/search?q=fin%20%26%20ops");
  });

  it("exposes typed failures through Effect methods", async () => {
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      fetch: async () =>
        Response.json({ _tag: "NotFound", message: "Item not found" }, { status: 404 }),
    });

    const result = await Effect.runPromise(client.getEffect("missing").pipe(Effect.either));

    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "NotFound", message: "Item not found" },
    });
  });

  it("interrupts in-flight Effect requests", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      fetch: async (_input, init) => {
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    });
    const controller = new AbortController();
    const running = Effect.runPromiseExit(client.getEffect("slow"), {
      signal: controller.signal,
    });

    await started;
    controller.abort();
    const exit = await running;

    expect(Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)).toBe(true);
  });

  it("preserves Promise transport rejection compatibility", async () => {
    const transportFailure = new TypeError("offline");
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      fetch: async () => Promise.reject(transportFailure),
    });

    await expect(client.get("missing")).rejects.toBe(transportFailure);
  });

  it("interrupts downloads while buffering the response body", async () => {
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    let bodyAborted = false;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/content")) {
          return Response.json({
            url: "https://blob.invalid/download",
            expiresAt: "2099-01-01T00:15:00.000Z",
          });
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              markBodyStarted();
              init?.signal?.addEventListener("abort", () => {
                bodyAborted = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              });
            },
          }),
        );
      },
    });
    const controller = new AbortController();
    const running = Effect.runPromiseExit(client.downloadBytesEffect(item.id), {
      signal: controller.signal,
    });

    await bodyStarted;
    controller.abort();
    const exit = await running;

    expect(bodyAborted).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)).toBe(true);
  });

  it("passes upload bodies directly to fetch", async () => {
    const body = new Blob(["hello"], { type: "text/plain" });
    const uploadBodies: unknown[] = [];
    const uploadHeaders: unknown[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/items")) {
          return Response.json({
            item,
            uploadUrl: "https://blob.invalid/upload",
            expiresAt: "2026-01-01T00:15:00.000Z",
            headers: { "content-type": "text/plain" },
          });
        }
        if (url === "https://blob.invalid/upload") {
          uploadBodies.push(init?.body);
          uploadHeaders.push(init?.headers);
          return new Response(null, { status: 200 });
        }
        if (url.endsWith(`/items/${item.id}/confirm`)) {
          return Response.json(item);
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });

    await expect(
      client.uploadBody(
        {
          name: "hello.txt",
          contentType: "text/plain",
          size: 5,
          source: "upload",
          properties: {},
        },
        body,
      ),
    ).resolves.toMatchObject({ id: item.id });
    expect(uploadBodies).toEqual([body]);
    expect(uploadHeaders).toEqual([{ "content-type": "text/plain" }]);
  });

  it("resumes confirmation with the original upload session", async () => {
    const calls: string[] = [];
    let confirms = 0;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/items") && init?.method === "POST") {
          return Response.json({
            item,
            uploadUrl: "https://blob.invalid/upload",
            expiresAt: "2099-01-01T00:15:00.000Z",
            headers: { "content-type": "text/plain" },
          });
        }
        if (url === "https://blob.invalid/upload") return new Response(null, { status: 200 });
        if (url.endsWith(`/items/${item.id}/confirm`)) {
          confirms++;
          return confirms === 1
            ? Response.json({ _tag: "Internal", message: "Lost response" }, { status: 500 })
            : Response.json(item);
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    const session = await client.startUpload({
      name: "hello.txt",
      contentType: "text/plain",
      size: 5,
      source: "upload",
      properties: {},
    });
    await client.putUpload(session, new Blob(["hello"]));
    await expect(client.completeUpload(session)).rejects.toMatchObject({ _tag: "Internal" });
    await expect(client.completeUpload(session)).resolves.toMatchObject({ id: item.id });
    expect(calls).toEqual([
      "POST https://keva.invalid/api/items",
      "PUT https://blob.invalid/upload",
      `POST https://keva.invalid/api/items/${item.id}/confirm`,
      `POST https://keva.invalid/api/items/${item.id}/confirm`,
    ]);
  });

  it("returns download URLs without fetching blob bytes", async () => {
    const calls: string[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json({
          url: "https://blob.invalid/download",
          expiresAt: "2026-01-01T00:15:00.000Z",
        });
      },
    });

    await expect(client.getDownloadUrl(item.id)).resolves.toEqual({
      url: "https://blob.invalid/download",
      expiresAt: "2026-01-01T00:15:00.000Z",
    });
    expect(calls).toEqual([`https://keva.invalid/api/items/${item.id}/content`]);
  });

  it("fetches usage from GET /usage", async () => {
    const calls: string[] = [];
    const payload = {
      itemCount: 3,
      totalBytes: 15,
      accountedItems: 3,
      quotaBytes: 100,
      quotaItems: 10,
      remainingBytes: 85,
      remainingItems: 7,
      period: null,
      byType: [{ contentType: "image/png", count: 2, bytes: 10 }],
    };
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json(payload);
      },
    });

    await expect(client.usage()).resolves.toEqual(payload);
    expect(calls).toEqual(["https://keva.invalid/api/usage"]);
  });

  it("buffers downloads only through downloadBytes", async () => {
    const calls: string[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith(`/items/${item.id}/content`)) {
          return Response.json({
            url: "https://blob.invalid/download",
            expiresAt: "2026-01-01T00:15:00.000Z",
          });
        }
        return new Response("hello", { status: 200 });
      },
    });

    await expect(client.downloadBytes(item.id)).resolves.toEqual(new TextEncoder().encode("hello"));
    expect(calls).toEqual([
      `https://keva.invalid/api/items/${item.id}/content`,
      "https://blob.invalid/download",
    ]);
  });

  it("creates and revokes shares over the owner session", async () => {
    const record = {
      id: "grant1",
      tenantId: "tenant",
      viewId: "view1",
      name: "Alpha",
      token: "keva_sh_abc_def",
      scopes: ["read", "write"] as const,
      conditions: [{ key: "project", op: "has_value" as const, value: "alpha" }],
      writeStamp: { project: "alpha" },
      allowOwnDelete: true,
      maxItemBytes: null,
      maxTotalBytes: null,
      maxItems: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      lastUsedAt: null,
    };
    const seen: { path: string; body: unknown }[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      fetch: async (input, init) => {
        const url = String(input);
        seen.push({ path: url, body: init?.body });
        if (url.endsWith("/shares") && init?.method === "POST") {
          return Response.json({
            token: "keva_sh_abc_def",
            record,
            view: {
              id: "view1",
              tenantId: "tenant",
              name: "Alpha",
              icon: null,
              conditions: record.conditions,
              createdAt: record.createdAt,
              updatedAt: record.createdAt,
            },
          });
        }
        if (url.endsWith("/shares/grant1") && init?.method === "DELETE") {
          return Response.json({ revoked: true });
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    const created = await client.createShare({
      name: "Alpha",
      viewId: "view1",
      scopes: ["read", "write"],
      writeStamp: { project: "alpha" },
    });
    expect(created.token).toBe("keva_sh_abc_def");
    expect(created.record.id).toBe("grant1");
    await expect(client.revokeShare("grant1")).resolves.toEqual({ revoked: true });
  });

  it("manages account-bound shares and received invitations", async () => {
    const received = {
      id: "grant-account",
      name: "Client drop",
      icon: null,
      scopes: ["write"] as const,
      allowOwnDelete: true,
      status: "pending" as const,
      owner: {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        avatar: { version: 1 as const, seed: "owner" },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      acceptedAt: null,
      expiresAt: null,
    };
    const account = {
      id: received.id,
      tenantId: "tenant",
      viewId: "view1",
      name: received.name,
      scopes: received.scopes,
      conditions: [{ key: "project", op: "has_value" as const, value: "alpha" }],
      writeStamp: { project: "alpha" },
      allowOwnDelete: true,
      maxItemBytes: null,
      maxTotalBytes: null,
      maxItems: null,
      status: received.status,
      recipient: {
        id: "recipient",
        name: "Recipient",
        email: "recipient@example.com",
        avatar: { version: 1 as const, seed: "recipient" },
      },
      createdAt: received.createdAt,
      acceptedAt: null,
      expiresAt: null,
    };
    const calls: string[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/account-shares") && init?.method === "POST") {
          return Response.json(account);
        }
        if (url.endsWith("/shared-views") && init?.method === "GET") {
          return Response.json([received]);
        }
        if (url.endsWith(`/shared-views/${received.id}/accept`)) {
          return Response.json({ ...received, status: "accepted", acceptedAt: received.createdAt });
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    await expect(
      client.createAccountShare({
        recipientEmail: "recipient@example.com",
        viewId: "view1",
        scopes: ["write"],
        writeStamp: { project: "alpha" },
      }),
    ).resolves.toMatchObject({ id: received.id });
    await expect(client.listReceivedShares()).resolves.toEqual([received]);
    await expect(client.acceptReceivedShare(received.id)).resolves.toMatchObject({
      status: "accepted",
    });
    expect(calls).toEqual([
      "POST https://keva.invalid/api/account-shares",
      "GET https://keva.invalid/api/shared-views",
      `POST https://keva.invalid/api/shared-views/${received.id}/accept`,
    ]);
  });

  it("recognizes share tokens by prefix", () => {
    expect(isShareToken("keva_sh_a_b")).toBe(true);
    expect(isShareToken("keva_sk_a_b")).toBe(false);
  });

  it("rejects non-string custom properties before sending a request", async () => {
    let called = false;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async () => {
        called = true;
        return Response.json(item);
      },
    });

    expect(() => client.patch(item.id, { set: { rating: 5 as never }, unset: [] })).toThrow();
    expect(called).toBe(false);
  });

  it("sends and decodes presentation metadata patches", async () => {
    let body: unknown;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ ...item, presentation: { image: { rotation: 90 } } });
      },
    });

    const updated = await client.patch(item.id, {
      set: {},
      unset: [],
      presentation: { image: { rotation: 90 } },
    });

    expect(body).toEqual({
      set: {},
      unset: [],
      presentation: { image: { rotation: 90 } },
    });
    expect(updated.presentation).toEqual({ image: { rotation: 90 } });
  });

  it("sends bulk patches with optional per-item revisions", async () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    let request: { url: string; method: string | undefined; body: unknown } | undefined;
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input, init) => {
        request = {
          url: String(input),
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        };
        return Response.json({
          updated: [{ id: item.id, revision: 2 }],
          failed: [{ id: secondId, error: { _tag: "Conflict", message: "Item revision changed" } }],
        });
      },
    });

    await expect(
      client.patchMany([{ id: item.id }, { id: secondId, expectedRevision: 4 }], {
        set: { reviewed: null },
        unset: ["draft"],
      }),
    ).resolves.toMatchObject({
      updated: [{ id: item.id, revision: 2 }],
      failed: [{ id: secondId, error: { _tag: "Conflict" } }],
    });
    expect(request).toEqual({
      url: "https://keva.invalid/api/items/patch",
      method: "POST",
      body: {
        items: [{ id: item.id }, { id: secondId, expectedRevision: 4 }],
        set: { reviewed: null },
        unset: ["draft"],
      },
    });
  });
});

describe("ShareClient", () => {
  const sharedItem = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "shared.txt",
    contentType: "text/plain",
    declaredSize: 5,
    size: 5,
    etag: "etag",
    source: "share:grant1",
    canDelete: true,
    status: "ready" as const,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    properties: { project: "alpha" },
  };

  it("sends the share bearer token and decodes redacted items", async () => {
    const authHeaders: unknown[] = [];
    let queryBody: unknown;
    const client = shareClient("https://keva.invalid/api", "keva_sh_abc_def");
    const withFetch = new ShareClient({
      baseUrl: "https://keva.invalid/api",
      shareToken: "keva_sh_abc_def",
      fetch: async (input, init) => {
        const url = String(input);
        authHeaders.push((init?.headers as Record<string, string>)?.authorization);
        if (url.endsWith("/query")) {
          queryBody = JSON.parse(String(init?.body));
          return Response.json({ items: [sharedItem], totalCount: 3 });
        }
        if (url.endsWith(`/items/${sharedItem.id}`) && init?.method === "DELETE") {
          return Response.json({ ok: true });
        }
        if (url.endsWith("/shares/self"))
          return Response.json({
            name: "Alpha",
            scopes: ["read"],
            expiresAt: null,
            allowOwnDelete: false,
            upload: null,
          });
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(client).toBeInstanceOf(ShareClient);

    const result = await withFetch.query({
      where: [],
      limit: 1,
      offset: 1,
      order: "created_at_desc",
    });
    expect(result.items[0]!.name).toBe("shared.txt");
    expect(result.totalCount).toBe(3);
    expect(queryBody).toMatchObject({ offset: 1 });
    expect(result.items[0]).not.toHaveProperty("storageKey");
    await withFetch.self();
    await withFetch.delete(sharedItem.id);
    expect(authHeaders).toEqual([
      "Bearer keva_sh_abc_def",
      "Bearer keva_sh_abc_def",
      "Bearer keva_sh_abc_def",
    ]);
  });

  it("uploads a file: initiate → PUT → confirm, returning a SharedItem", async () => {
    const calls: string[] = [];
    const client = new ShareClient({
      baseUrl: "https://keva.invalid/api",
      shareToken: "keva_sh_abc_def",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/items") && init?.method === "POST") {
          return Response.json({
            item: sharedItem,
            uploadUrl: "https://blob.invalid/upload",
            expiresAt: "2026-01-01T00:15:00.000Z",
            headers: { "content-type": "text/plain" },
          });
        }
        if (url === "https://blob.invalid/upload") return new Response(null, { status: 200 });
        if (url.endsWith(`/items/${sharedItem.id}/confirm`)) return Response.json(sharedItem);
        throw new Error(`unexpected ${url}`);
      },
    });

    const file = new File(["hello"], "shared.txt", { type: "text/plain" });
    await expect(client.uploadFile(file)).resolves.toMatchObject({
      id: sharedItem.id,
      properties: { project: "alpha" },
    });
    expect(calls).toEqual([
      "POST https://keva.invalid/api/items",
      "PUT https://blob.invalid/upload",
      `POST https://keva.invalid/api/items/${sharedItem.id}/confirm`,
    ]);
  });
});

describe("SharedViewClient", () => {
  it("uses the authenticated grant route without a bearer credential", async () => {
    const headers: unknown[] = [];
    const credentials: unknown[] = [];
    const client = new SharedViewClient({
      baseUrl: "https://keva.invalid/api",
      grantId: "grant-account",
      fetch: async (input, init) => {
        headers.push(init?.headers);
        credentials.push(init?.credentials);
        const url = String(input);
        if (url.endsWith("/shared-views/grant-account/self")) {
          return Response.json({
            name: "Client drop",
            icon: "inbox",
            owner: {
              id: "owner",
              name: "Owner",
              email: "owner@example.com",
              avatar: { version: 1, seed: "owner" },
            },
            scopes: ["write"],
            expiresAt: null,
            allowOwnDelete: true,
            upload: {
              maxItemBytes: null,
              maxTotalBytes: null,
              maxItems: null,
              usedBytes: 0,
              usedItems: 0,
            },
          });
        }
        if (url.endsWith("/shared-views/grant-account/query")) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ offset: 0 });
          return Response.json({ items: [], totalCount: 0 });
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    await expect(client.self()).resolves.toMatchObject({ name: "Client drop", icon: "inbox" });
    await expect(
      client.query({ where: [], limit: 10, offset: 0, order: "created_at_desc" }),
    ).resolves.toMatchObject({ totalCount: 0 });
    expect(headers).toEqual([{}, { "content-type": "application/json" }]);
    expect(credentials).toEqual(["include", "include"]);
  });
});
