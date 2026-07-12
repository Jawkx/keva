import { describe, expect, it } from "vitest";
import worker from "./worker.js";

describe("worker entry", () => {
  const env = {
    KEVA_STATIC_TOKEN: "static-token",
    KEVA_BASE_URL: "http://worker.test",
    KEVA_TENANT_ID: "tenant",
    KEVA_RUNTIME_MODE: "persistent",
    HYPERDRIVE: { connectionString: "postgres://worker.test/keva" },
    S3_ENDPOINT: "https://storage.worker.test",
    S3_ACCESS_KEY_ID: "access-key",
    S3_SECRET_ACCESS_KEY: "secret-key",
    S3_BUCKET: "keva",
  };

  it("serves liveness only after persistent Worker configuration is complete", async () => {
    const health = await worker.fetch(new Request("http://worker.test/health"), env);
    expect(health.status).toBe(200);
  });

  it("sets no-referrer for public share documents", async () => {
    const response = await worker.fetch(new Request("http://worker.test/s/keva_sh_secret"), {
      ASSETS: { fetch: async () => new Response("share") },
    });
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("rejects Worker local-memory mode", async () => {
    await expect(
      worker.fetch(new Request("http://worker.test/health"), {
        KEVA_STATIC_TOKEN: "static-token",
        KEVA_BASE_URL: "http://worker.test",
        KEVA_RUNTIME_MODE: "local-memory",
      }),
    ).rejects.toThrow('KEVA_RUNTIME_MODE must be "persistent" for Worker deployments');
  });

  it("fails closed when a persistent Worker binding is missing", async () => {
    await expect(
      worker.fetch(new Request("http://worker.test/health"), {
        KEVA_STATIC_TOKEN: "static-token",
        KEVA_BASE_URL: "http://worker.test",
        KEVA_RUNTIME_MODE: "persistent",
        HYPERDRIVE: { connectionString: "postgres://worker.test/keva" },
        S3_ENDPOINT: "https://storage.worker.test",
        S3_ACCESS_KEY_ID: "access-key",
        S3_BUCKET: "keva",
      }),
    ).rejects.toThrow("S3_SECRET_ACCESS_KEY is required");
  });
});
