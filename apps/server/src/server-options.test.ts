import { afterEach, describe, expect, it } from "vitest";
import { databaseUnitMetrics, resetDatabaseUnitMetrics } from "./database.js";
import { createServerOptions } from "./server-options.js";

const persistentOptions = () =>
  createServerOptions({
    staticToken: "test-token",
    tenantId: "test",
    baseUrl: "http://keva.test",
    databaseUrl: "postgres://keva.test/keva",
    s3: {
      endpoint: "https://storage.keva.test",
      region: "auto",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "keva",
      forcePathStyle: true,
    },
  });

describe("server database unit", () => {
  afterEach(resetDatabaseUnitMetrics);

  it("constructs and disposes exactly one client for database-backed services", async () => {
    resetDatabaseUnitMetrics();
    const options = persistentOptions();

    expect(databaseUnitMetrics()).toEqual({ created: 1, disposed: 0, active: 1 });
    await options.dispose?.();
    await options.dispose?.();
    expect(databaseUnitMetrics()).toEqual({ created: 1, disposed: 1, active: 0 });
  });
});
