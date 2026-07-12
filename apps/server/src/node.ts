import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { trustedOriginsFor } from "./origins.js";
import { runtimeModeFor, s3For } from "./runtime-mode.js";
import { createServerOptions } from "./server-options.js";

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
const mode = runtimeModeFor(process.env.KEVA_RUNTIME_MODE);
const databaseUrl = process.env.DATABASE_URL;
if (mode === "persistent" && !databaseUrl) throw new Error("DATABASE_URL is required");
if (mode === "local-memory" && databaseUrl) {
  throw new Error("DATABASE_URL is not allowed when KEVA_RUNTIME_MODE is local-memory");
}
const s3 = s3For(mode, {
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
});
const appOptions = createServerOptions({
  mode,
  staticToken: required("KEVA_STATIC_TOKEN"),
  tenantId: process.env.KEVA_TENANT_ID ?? "local",
  baseUrl,
  ...(process.env.KEVA_LOOPBACK_BASE_URL !== undefined
    ? { loopbackBaseUrl: process.env.KEVA_LOOPBACK_BASE_URL }
    : {}),
  ...(databaseUrl ? { databaseUrl } : {}),
  ...(process.env.BETTER_AUTH_SECRET ? { betterAuthSecret: process.env.BETTER_AUTH_SECRET } : {}),
  ...(process.env.BETTER_AUTH_URL ? { betterAuthUrl: process.env.BETTER_AUTH_URL } : {}),
  ...(process.env.KEVA_ADMIN_TOKEN ? { adminToken: process.env.KEVA_ADMIN_TOKEN } : {}),
  trustedOrigins,
  ...(s3 ? { s3 } : {}),
});

serve(
  {
    fetch: createApp(appOptions).fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`keva listening on http://127.0.0.1:${info.port}`);
  },
);
