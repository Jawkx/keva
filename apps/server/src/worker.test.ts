import { describe, expect, it } from "vitest";
import worker from "./worker.js";

describe("worker entry", () => {
  const env = {
    KEVA_STATIC_TOKEN: "static-token",
    KEVA_BASE_URL: "http://worker.test",
    KEVA_TENANT_ID: "tenant",
  };

  it("serves health and static-token data routes without Better Auth", async () => {
    const health = await worker.fetch(new Request("http://worker.test/health"), env);
    expect(health.status).toBe(200);

    const query = await worker.fetch(
      new Request("http://worker.test/api/query", {
        method: "POST",
        headers: {
          authorization: "Bearer static-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ where: [] }),
      }),
      env,
    );
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({ items: [] });
  });

  it("fails closed when required Worker secrets are missing", async () => {
    await expect(
      worker.fetch(
        new Request("http://worker.test/api/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ where: [] }),
        }),
        { KEVA_BASE_URL: "http://worker.test" },
      ),
    ).rejects.toThrow("KEVA_STATIC_TOKEN is required");
  });
});
