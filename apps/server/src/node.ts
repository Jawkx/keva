import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { trustedOriginsFor } from "./origins.js";
import { s3ConfigFor } from "./s3-config.js";
import { createServerOptions } from "./server-options.js";
import { emailVerificationConfigFor } from "./email-verification.js";
import { billingConfigFor } from "./billing-config.js";
import { googleOAuthConfigFor } from "./google-oauth-config.js";
import { MemoryRealtimeGateway } from "./realtime-memory.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
  throw new Error("The Node server only supports loopback hosts");
}
const baseUrl = process.env.KEVA_BASE_URL ?? `http://127.0.0.1:${port}`;
// Origins Better Auth will accept (CSRF). The browser hits the web app's origin
// (proxied to this API), so it must be trusted. Defaults cover the Vite dev
// server; set KEVA_TRUSTED_ORIGINS (comma-separated) in production.
const trustedOrigins = trustedOriginsFor(baseUrl, process.env.KEVA_TRUSTED_ORIGINS, [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const s3 = s3ConfigFor({
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
});
const emailVerification = emailVerificationConfigFor({
  KEVA_ENVIRONMENT: process.env.KEVA_ENVIRONMENT,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
});
const googleOAuth = googleOAuthConfigFor({
  KEVA_ENVIRONMENT: process.env.KEVA_ENVIRONMENT,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
});
const polar = billingConfigFor({
  POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
  POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
  POLAR_SERVER: process.env.POLAR_SERVER,
  POLAR_PRODUCT_100GB_ID: process.env.POLAR_PRODUCT_100GB_ID,
  POLAR_PRODUCT_500GB_ID: process.env.POLAR_PRODUCT_500GB_ID,
  POLAR_PRODUCT_1TB_ID: process.env.POLAR_PRODUCT_1TB_ID,
  POLAR_PRODUCT_2TB_ID: process.env.POLAR_PRODUCT_2TB_ID,
});
const realtime = new MemoryRealtimeGateway();
const appOptions = createServerOptions({
  staticToken: required("KEVA_STATIC_TOKEN"),
  tenantId: process.env.KEVA_TENANT_ID ?? "local",
  baseUrl,
  databaseUrl: required("DATABASE_URL"),
  ...(process.env.BETTER_AUTH_SECRET
    ? {
        betterAuthSecret: process.env.BETTER_AUTH_SECRET,
        betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
      }
    : {}),
  ...(emailVerification ? { emailVerification } : {}),
  ...(googleOAuth ? { googleOAuth } : {}),
  ...(polar ? { polar } : {}),
  trustedOrigins,
  realtime,
  s3,
});

const app = createApp(appOptions);
const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`keva listening on http://127.0.0.1:${info.port}`);
  },
);

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "server.shutdown.started", signal }));
  const failures: unknown[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await app.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Server shutdown failed");
  console.log(JSON.stringify({ event: "server.shutdown.completed", signal }));
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "server.shutdown.failed",
          signal,
          errorType: error instanceof Error ? error.name : typeof error,
        }),
      );
      process.exitCode = 1;
    });
  });
}
