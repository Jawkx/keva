import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createApp } from "./app.js";
import * as authSchema from "./auth-schema.js";
import { betterAuthSessionResolver, createBetterAuth } from "./better-auth.js";
import { trustedOriginsFor } from "./origins.js";
import { makeRuntimeLayer } from "./runtime.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.KEVA_BASE_URL ?? `http://127.0.0.1:${port}`;
// Origins Better Auth will accept (CSRF). The browser hits the web app's origin
// (proxied to this API), so it must be trusted. Defaults cover the Vite dev
// server; set KEVA_TRUSTED_ORIGINS (comma-separated) in production.
const trustedOrigins = trustedOriginsFor(baseUrl, process.env.KEVA_TRUSTED_ORIGINS, [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const s3 = process.env.S3_ENDPOINT
  ? {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    }
  : undefined;
const auth =
  process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET
    ? createBetterAuth({
        database: drizzle(postgres(process.env.DATABASE_URL), {
          schema: authSchema,
        }),
        secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL ?? baseUrl,
        trustedOrigins,
      })
    : undefined;

const layer = makeRuntimeLayer({
  staticToken: required("KEVA_STATIC_TOKEN"),
  tenantId: process.env.KEVA_TENANT_ID ?? "local",
  baseUrl,
  // Set KEVA_LOOPBACK_BASE_URL="" when serving the web app behind a dev proxy
  // so loopback blob URLs are relative and forwarded same-origin.
  ...(process.env.KEVA_LOOPBACK_BASE_URL !== undefined
    ? { loopbackBaseUrl: process.env.KEVA_LOOPBACK_BASE_URL }
    : {}),
  ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
  ...(auth ? { sessionResolver: betterAuthSessionResolver(auth) } : {}),
  ...(s3 ? { s3 } : {}),
});

serve(
  {
    fetch: createApp({
      layer,
      ...(auth ? { authHandler: auth.handler } : {}),
    }).fetch,
    port,
  },
  (info) => {
    console.log(`keva listening on http://127.0.0.1:${info.port}`);
  },
);
