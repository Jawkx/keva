import {
  MemoryBlobStoreLive,
  MemoryMetadataStoreLive,
} from "@keva/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ApiTokenStore, StaticTokenAuthLive } from "./auth.js";
import { createApp } from "./app.js";

const layer = Layer.mergeAll(
  MemoryMetadataStoreLive,
  MemoryBlobStoreLive(),
  StaticTokenAuthLive({ token: "test-secret", tenantId: "test-tenant" }),
  Layer.succeed(ApiTokenStore, {
    resolve: () => Effect.succeed(null),
    mint: () => Effect.die("not used"),
    list: () => Effect.succeed([]),
    revoke: () => Effect.succeed(false),
  }),
);

const auth = { authorization: "Bearer test-secret" };

describe("server API", () => {
  it("requires authentication and completes the local upload flow", async () => {
    const app = createApp({ layer });
    const unauthorized = await app.request("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ _tag: "Unauthorized" });

    const initiatedResponse = await app.request("/api/objects", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        name: "hello.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });
    expect(initiatedResponse.status).toBe(200);
    const initiated = await initiatedResponse.json() as {
      object: { id: string };
      uploadUrl: string;
      headers: Record<string, string>;
    };

    const uploadUrl = new URL(initiated.uploadUrl);
    const uploaded = await app.request(
      `${uploadUrl.pathname}${uploadUrl.search}`,
      {
        method: "PUT",
        headers: initiated.headers,
        body: "hello",
      },
    );
    expect(uploaded.status).toBe(200);

    const confirmed = await app.request(
      `/api/objects/${initiated.object.id}/confirm`,
      { method: "POST", headers: auth },
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      id: initiated.object.id,
      status: "ready",
      size: 5,
    });

    const queried = await app.request("/api/query", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        where: [{ key: "name", op: "eq", value: "hello.txt" }],
      }),
    });
    expect(queried.status).toBe(200);
    expect((await queried.json() as { objects: unknown[] }).objects).toHaveLength(1);
  });
});
