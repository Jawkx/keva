import { describe, expect, it } from "vitest";
import { isShareToken, KevaClient, KevaProtocolError, ShareClient, shareClient } from "./index.js";

describe("KevaClient", () => {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant",
    name: "hello.txt",
    contentType: "text/plain",
    declaredSize: 5,
    size: 5,
    etag: "etag",
    checksum: null,
    source: "upload",
    status: "ready" as const,
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
      quotaBytes: 100,
      remainingBytes: 85,
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
      scopes: ["read", "write"] as const,
      conditions: [{ key: "project", op: "eq" as const, value: "alpha" }],
      writeStamp: { project: "alpha" },
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
          return Response.json({ token: "keva_sh_abc_def", record });
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

  it("recognizes share tokens by prefix", () => {
    expect(isShareToken("keva_sh_a_b")).toBe(true);
    expect(isShareToken("keva_sk_a_b")).toBe(false);
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
    checksum: null,
    source: "share:grant1",
    status: "ready" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    properties: { project: "alpha" },
  };

  it("sends the share bearer token and decodes redacted items", async () => {
    const authHeaders: unknown[] = [];
    const client = shareClient("https://keva.invalid/api", "keva_sh_abc_def");
    const withFetch = new ShareClient({
      baseUrl: "https://keva.invalid/api",
      shareToken: "keva_sh_abc_def",
      fetch: async (input, init) => {
        const url = String(input);
        authHeaders.push((init?.headers as Record<string, string>)?.authorization);
        if (url.endsWith("/query")) return Response.json({ items: [sharedItem] });
        if (url.endsWith("/shares/self"))
          return Response.json({ name: "Alpha", scopes: ["read"], expiresAt: null, upload: null });
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(client).toBeInstanceOf(ShareClient);

    const result = await withFetch.query();
    expect(result.items[0]!.name).toBe("shared.txt");
    expect(result.items[0]).not.toHaveProperty("storageKey");
    await withFetch.self();
    expect(authHeaders).toEqual(["Bearer keva_sh_abc_def", "Bearer keva_sh_abc_def"]);
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
