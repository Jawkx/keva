import { describe, expect, it } from "vitest";
import { databaseUnitMetrics, resetDatabaseUnitMetrics } from "./database.js";
import worker from "./worker.js";

describe("worker entry", () => {
  const env = {
    KEVA_STATIC_TOKEN: "static-token",
    KEVA_BASE_URL: "http://worker.test",
    KEVA_TENANT_ID: "tenant",
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

  it("disposes request-scoped database units", async () => {
    resetDatabaseUnitMetrics();
    const response = await worker.fetch(
      new Request("http://worker.test/api/auth/get-session"),
      env,
    );
    expect(response.status).toBe(404);
    expect(databaseUnitMetrics()).toEqual({ created: 1, disposed: 1, active: 0 });
  });

  it("sets no-referrer for public share documents", async () => {
    const response = await worker.fetch(new Request("http://worker.test/s/keva_sh_secret"), {
      ASSETS: { fetch: async () => new Response("share") },
      S3_ENDPOINT: "https://storage.worker.test/path",
    });
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const contentSecurityPolicy = response.headers.get("Content-Security-Policy");
    expect(contentSecurityPolicy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(contentSecurityPolicy).toContain("style-src-attr 'unsafe-inline'");
    expect(contentSecurityPolicy).toContain(
      "connect-src 'self' https://storage.worker.test https://cdn.jsdelivr.net blob:",
    );
  });

  it("maps versioned public API requests onto data routes", async () => {
    const response = await worker.fetch(new Request("https://api.worker.test/v1/items/missing"), {
      ...env,
      KEVA_PUBLIC_API_HOST: "api.worker.test",
    });
    expect(response.status).toBe(401);
  });

  it("does not serve app assets from the public API host", async () => {
    const response = await worker.fetch(new Request("https://api.worker.test/login"), {
      ASSETS: { fetch: async () => new Response("app") },
      KEVA_PUBLIC_API_HOST: "api.worker.test",
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ message: "Not found" });
  });

  it("fails closed when a persistent Worker binding is missing", async () => {
    await expect(
      worker.fetch(new Request("http://worker.test/health"), {
        KEVA_STATIC_TOKEN: "static-token",
        KEVA_BASE_URL: "http://worker.test",
        HYPERDRIVE: { connectionString: "postgres://worker.test/keva" },
        S3_ENDPOINT: "https://storage.worker.test",
        S3_ACCESS_KEY_ID: "access-key",
        S3_BUCKET: "keva",
      }),
    ).rejects.toThrow("S3_SECRET_ACCESS_KEY is required");
  });
});
