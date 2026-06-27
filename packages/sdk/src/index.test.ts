import { describe, expect, it } from "vitest";
import { KevaClient, KevaProtocolError } from "./index.js";

describe("KevaClient", () => {
  const object = {
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
    storageKey: "objects/tenant/id",
    stagingKey: "staging/tenant/id",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attributes: {},
  };

  it("throws the shared typed error contract", async () => {
    const client = new KevaClient({
      baseUrl: "https://keva.invalid",
      token: "test",
      fetch: async () =>
        Response.json(
          { _tag: "NotFound", message: "Object not found" },
          { status: 404 },
        ),
    });

    await expect(client.get("missing")).rejects.toMatchObject({
      _tag: "NotFound",
      message: "Object not found",
    });

    const unauthorized = new KevaClient({
      baseUrl: "https://keva.invalid",
      token: "bad",
      fetch: async () =>
        Response.json(
          { _tag: "Unauthorized", message: "Invalid credential" },
          { status: 401 },
        ),
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
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/objects")) {
          return Response.json({
            object,
            uploadUrl: "https://blob.invalid/upload",
            expiresAt: "2026-01-01T00:15:00.000Z",
            headers: { "content-type": "text/plain" },
          });
        }
        if (url === "https://blob.invalid/upload") {
          uploadBodies.push(init?.body);
          return new Response(null, { status: 200 });
        }
        if (url.endsWith(`/objects/${object.id}/confirm`)) {
          return Response.json(object);
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });

    await expect(
      client.uploadBody({
        name: "hello.txt",
        contentType: "text/plain",
        size: 5,
        source: "upload",
        attributes: {},
      }, body),
    ).resolves.toMatchObject({ id: object.id });
    expect(uploadBodies).toEqual([body]);
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

    await expect(client.getDownloadUrl(object.id)).resolves.toEqual({
      url: "https://blob.invalid/download",
      expiresAt: "2026-01-01T00:15:00.000Z",
    });
    expect(calls).toEqual([
      `https://keva.invalid/api/objects/${object.id}/content`,
    ]);
  });

  it("buffers downloads only through downloadBytes", async () => {
    const calls: string[] = [];
    const client = new KevaClient({
      baseUrl: "https://keva.invalid/api",
      token: "test",
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith(`/objects/${object.id}/content`)) {
          return Response.json({
            url: "https://blob.invalid/download",
            expiresAt: "2026-01-01T00:15:00.000Z",
          });
        }
        return new Response("hello", { status: 200 });
      },
    });

    await expect(client.downloadBytes(object.id)).resolves.toEqual(
      new TextEncoder().encode("hello"),
    );
    expect(calls).toEqual([
      `https://keva.invalid/api/objects/${object.id}/content`,
      "https://blob.invalid/download",
    ]);
  });
});
