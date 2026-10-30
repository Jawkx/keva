import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { databaseUnitMetrics, resetDatabaseUnitMetrics } from "./database.js";
import { createServerOptions } from "./server-options.js";
import { TestRealtimeGateway } from "./test/realtime-gateway.js";

const persistentOptions = () =>
  createServerOptions({
    staticToken: "test-token",
    tenantId: "test",
    baseUrl: "http://keva.test",
    databaseUrl: "postgres://keva.test/keva",
    realtime: new TestRealtimeGateway(),
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

  it("lets the app own and idempotently dispose its database-backed services", async () => {
    resetDatabaseUnitMetrics();
    const options = persistentOptions();
    const app = createApp(options);

    expect(databaseUnitMetrics()).toEqual({ created: 1, disposed: 0, active: 1 });
    await app.dispose();
    await app.dispose();
    expect(databaseUnitMetrics()).toEqual({ created: 1, disposed: 1, active: 0 });
  });
});
