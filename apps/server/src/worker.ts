import { randomUUID } from "node:crypto";
import { makeThumbnailJobStore } from "@keva/core/postgres";
import { Effect } from "effect";
import postgres from "postgres";
import { createApp } from "./app.js";
import { runLifecycle } from "./lifecycle.js";
import { trustedOriginsFor } from "./origins.js";
import { s3ConfigFor } from "./s3-config.js";
import { createServerOptions, type ServerOptionsConfig } from "./server-options.js";
import { emailVerificationConfigFor } from "./email-verification.js";
import { billingConfigFor } from "./billing-config.js";
import { googleOAuthConfigFor } from "./google-oauth-config.js";
import { MediaContainer, mediaContainerFor, type MediaContainerConfig } from "./media-container.js";
import {
  RealtimeHub,
  makeDurableObjectRealtimeGateway,
  type DurableObjectNamespace,
} from "./realtime-durable-object.js";

export { MediaContainer, RealtimeHub };

interface AssetsBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}

interface Env {
  readonly ASSETS?: AssetsBinding;
  readonly KEVA_STATIC_TOKEN?: string;
  readonly KEVA_TENANT_ID?: string;
  readonly KEVA_BASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
  readonly KEVA_TRUSTED_ORIGINS?: string;
  readonly KEVA_PUBLIC_API_HOST?: string;
  readonly KEVA_ENVIRONMENT?: string;
  readonly MEDIA_DATABASE_URL?: string;
  readonly MEDIA_DIAGNOSTIC_TOKEN?: string;
  readonly THUMBNAIL_JOBS_ENABLED?: string;
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly POLAR_ACCESS_TOKEN?: string;
  readonly POLAR_WEBHOOK_SECRET?: string;
  readonly POLAR_SERVER?: string;
  readonly POLAR_PRODUCT_100GB_ID?: string;
  readonly POLAR_PRODUCT_500GB_ID?: string;
  readonly POLAR_PRODUCT_1TB_ID?: string;
  readonly POLAR_PRODUCT_2TB_ID?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly REALTIME?: DurableObjectNamespace;
  readonly MEDIA?: {
    readonly getByName: (name: string) => {
      readonly fetchWithConfig: (
        request: Request,
        config: MediaContainerConfig,
      ) => Promise<Response>;
    };
  };
  readonly S3_ENDPOINT?: string;
  readonly S3_REGION?: string;
  readonly S3_ACCESS_KEY_ID?: string;
  readonly S3_SECRET_ACCESS_KEY?: string;
  readonly S3_BUCKET?: string;
  readonly S3_FORCE_PATH_STYLE?: string;
}

let app: ReturnType<typeof createApp> | undefined;

interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
  readonly props: Record<string, unknown>;
}

const serverPaths = ["/api", "/mcp", "/.well-known", "/health", "/ready", "/__dev"];

const isServerPath = (pathname: string): boolean =>
  serverPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

const publicApiRequestFor = (request: Request, publicApiHost?: string): Request | Response => {
  if (!publicApiHost) return request;
  const url = new URL(request.url);
  if (url.hostname !== publicApiHost) return request;
  if (url.pathname === "/health" || url.pathname === "/ready") return request;
  if (url.pathname !== "/v1" && !url.pathname.startsWith("/v1/")) {
    return Response.json({ message: "Not found" }, { status: 404 });
  }
  url.pathname = `/api${url.pathname.slice(3)}`;
  return new Request(url, request);
};

const required = <T>(value: T | undefined, name: string): T => {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
};

const persistentConfigFor = (env: Env) => ({
  databaseUrl: required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE"),
  s3: s3ConfigFor(env),
});

const mediaConfigFor = (env: Env): MediaContainerConfig => ({
  environment: required(env.KEVA_ENVIRONMENT, "KEVA_ENVIRONMENT"),
  databaseUrl: required(env.MEDIA_DATABASE_URL, "MEDIA_DATABASE_URL"),
  s3Endpoint: required(env.S3_ENDPOINT, "S3_ENDPOINT"),
  s3Region: required(env.S3_REGION, "S3_REGION"),
  s3AccessKeyId: required(env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: required(env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY"),
  s3Bucket: required(env.S3_BUCKET, "S3_BUCKET"),
  s3ForcePathStyle: env.S3_FORCE_PATH_STYLE ?? "true",
});

const fetchMediaContainer = (env: Env, request: Request): Promise<Response> => {
  const environment = required(env.KEVA_ENVIRONMENT, "KEVA_ENVIRONMENT");
  return mediaContainerFor(required(env.MEDIA, "MEDIA"), environment).fetchWithConfig(
    request,
    mediaConfigFor(env),
  );
};

interface MediaDrainResult {
  readonly readyItemIds?: readonly string[];
  readonly failedItemIds?: readonly string[];
}

const wakeMediaJobs = async (
  env: Env,
  realtime: ReturnType<typeof makeDurableObjectRealtimeGateway>,
): Promise<void> => {
  if (env.THUMBNAIL_JOBS_ENABLED !== "true") return;
  const databaseUrl = required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    if (!(await makeThumbnailJobStore(sql).hasRunnableJobs())) return;
  } finally {
    await sql.end({ timeout: 2 });
  }
  const response = await fetchMediaContainer(
    env,
    new Request("http://container/drain", { method: "POST" }),
  );
  if (!response.ok) throw new Error(`Media drain failed: ${response.status}`);
  const result = (await response.json()) as MediaDrainResult;
  const occurredAt = new Date().toISOString();
  await Promise.all([
    ...(result.readyItemIds ?? []).map((itemId) =>
      Effect.runPromise(
        realtime.publisher.publish(env.KEVA_TENANT_ID ?? "staging", {
          id: randomUUID(),
          type: "items.changed",
          reason: "thumbnail_ready",
          itemId,
          occurredAt,
        }),
      ),
    ),
    ...(result.failedItemIds ?? []).map((itemId) =>
      Effect.runPromise(
        realtime.publisher.publish(env.KEVA_TENANT_ID ?? "staging", {
          id: randomUUID(),
          type: "items.changed",
          reason: "thumbnail_failed",
          itemId,
          occurredAt,
        }),
      ),
    ),
  ]);
};

const serverOptionsConfigFor = (
  env: Env,
  executionContext: ExecutionContext,
): ServerOptionsConfig => {
  const staticToken = required(env.KEVA_STATIC_TOKEN, "KEVA_STATIC_TOKEN");
  const baseUrl = required(env.KEVA_BASE_URL, "KEVA_BASE_URL");
  const { databaseUrl, s3 } = persistentConfigFor(env);
  const baseRealtime = makeDurableObjectRealtimeGateway(
    required(env.REALTIME, "REALTIME"),
    executionContext,
  );
  const realtime = {
    ...baseRealtime,
    publisher: {
      publish: (tenantId: string, event: Parameters<typeof baseRealtime.publisher.publish>[1]) =>
        baseRealtime.publisher.publish(tenantId, event).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (event.reason === "uploaded") {
                executionContext.waitUntil(wakeMediaJobs(env, baseRealtime));
              }
            }),
          ),
        ),
    },
  };
  const emailVerification = emailVerificationConfigFor(env);
  const googleOAuth = googleOAuthConfigFor(env);
  const polar = billingConfigFor(env);

  return {
    staticToken,
    tenantId: env.KEVA_TENANT_ID ?? "local",
    baseUrl,
    databaseUrl,
    ...(env.BETTER_AUTH_SECRET ? { betterAuthSecret: env.BETTER_AUTH_SECRET } : {}),
    ...(env.BETTER_AUTH_URL ? { betterAuthUrl: env.BETTER_AUTH_URL } : {}),
    ...(emailVerification ? { emailVerification } : {}),
    ...(googleOAuth ? { googleOAuth } : {}),
    ...(polar ? { polar } : {}),
    trustedOrigins: trustedOriginsFor(baseUrl, env.KEVA_TRUSTED_ORIGINS),
    realtime,
    s3,
  };
};

const makeApp = (): ReturnType<typeof createApp> =>
  createApp({
    getRequestServices: (context) =>
      createServerOptions(
        serverOptionsConfigFor(context.env as Env, context.executionCtx as ExecutionContext),
      ),
  });

const withBrowserSecurityHeaders = (
  response: Response,
  storageEndpoint?: string,
  share = false,
): Response => {
  const headers = new Headers(response.headers);
  const storageOrigin = storageEndpoint ? new URL(storageEndpoint).origin : undefined;
  const connectSource = storageOrigin ? `'self' ${storageOrigin}` : "'self'";
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src ${connectSource} blob: data:; media-src ${connectSource} blob:; font-src 'self'; connect-src ${connectSource} https://cdn.jsdelivr.net blob:; worker-src 'self' blob:`,
  );
  headers.set("Referrer-Policy", share ? "no-referrer" : "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: ExecutionContext = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    },
  ): Promise<Response> {
    const publicApiRequest = publicApiRequestFor(request, env.KEVA_PUBLIC_API_HOST);
    if (publicApiRequest instanceof Response) return publicApiRequest;
    const url = new URL(publicApiRequest.url);
    if (url.pathname === "/__dev/media/health" || url.pathname === "/__dev/media/drain") {
      const diagnosticToken = env.MEDIA_DIAGNOSTIC_TOKEN;
      if (
        env.KEVA_ENVIRONMENT !== "staging" ||
        !diagnosticToken ||
        request.headers.get("authorization") !== `Bearer ${diagnosticToken}`
      ) {
        return Response.json({ message: "Not found" }, { status: 404 });
      }
      const endpoint = url.pathname.endsWith("/drain") ? "drain" : "diagnostic";
      return fetchMediaContainer(
        env,
        new Request(`http://container/${endpoint}`, { method: "POST" }),
      );
    }
    if (!isServerPath(url.pathname) && env.ASSETS) {
      const response = await env.ASSETS.fetch(publicApiRequest);
      return withBrowserSecurityHeaders(response, env.S3_ENDPOINT, url.pathname.startsWith("/s/"));
    }

    serverOptionsConfigFor(env, executionContext);
    if (!app) app = makeApp();
    return app.fetch(publicApiRequest, env, executionContext);
  },

  scheduled(controller: { readonly cron?: string }, env: Env, context: ExecutionContext): void {
    const realtime = makeDurableObjectRealtimeGateway(required(env.REALTIME, "REALTIME"), context);
    if (controller.cron === "*/5 * * * *") {
      context.waitUntil(
        wakeMediaJobs(env, realtime).catch(() =>
          console.error(JSON.stringify({ event: "media.recovery.failed" })),
        ),
      );
      return;
    }
    context.waitUntil(
      Promise.resolve()
        .then(async () => {
          const result = await runLifecycle(persistentConfigFor(env));
          if (env.THUMBNAIL_JOBS_ENABLED === "true") {
            const sql = postgres(required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE"), {
              max: 1,
            });
            try {
              const jobs = makeThumbnailJobStore(sql);
              await jobs.releaseExpiredLeases();
              await jobs.enqueueMissing({ limit: 200 });
            } finally {
              await sql.end({ timeout: 2 });
            }
            await wakeMediaJobs(env, realtime);
          }
          return result;
        })
        .then(
          (result) =>
            console.log(JSON.stringify({ event: "lifecycle.cleanup.completed", ...result })),
          () => console.error(JSON.stringify({ event: "lifecycle.cleanup.failed" })),
        ),
    );
  },
};
