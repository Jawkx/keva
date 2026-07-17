import { createApp } from "./app.js";
import { runLifecycle } from "./lifecycle.js";
import { trustedOriginsFor } from "./origins.js";
import { s3ConfigFor } from "./s3-config.js";
import { createServerOptions, type ServerOptionsConfig } from "./server-options.js";
import { emailVerificationConfigFor } from "./email-verification.js";

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
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
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

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const persistentConfigFor = (env: Env) => ({
  databaseUrl: required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE"),
  s3: s3ConfigFor(env),
});

const serverOptionsConfigFor = (env: Env): ServerOptionsConfig => {
  const staticToken = required(env.KEVA_STATIC_TOKEN, "KEVA_STATIC_TOKEN");
  const baseUrl = required(env.KEVA_BASE_URL, "KEVA_BASE_URL");
  const { databaseUrl, s3 } = persistentConfigFor(env);
  const emailVerification = emailVerificationConfigFor(env);

  return {
    staticToken,
    tenantId: env.KEVA_TENANT_ID ?? "local",
    baseUrl,
    databaseUrl,
    ...(env.BETTER_AUTH_SECRET ? { betterAuthSecret: env.BETTER_AUTH_SECRET } : {}),
    ...(env.BETTER_AUTH_URL ? { betterAuthUrl: env.BETTER_AUTH_URL } : {}),
    ...(emailVerification ? { emailVerification } : {}),
    trustedOrigins: trustedOriginsFor(baseUrl, env.KEVA_TRUSTED_ORIGINS),
    s3,
  };
};

const makeApp = (): ReturnType<typeof createApp> =>
  createApp({
    getRequestServices: (context) =>
      createServerOptions(serverOptionsConfigFor(context.env as Env)),
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
    `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src ${connectSource} https://cdn.jsdelivr.net; worker-src 'self' blob:`,
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const publicApiRequest = publicApiRequestFor(request, env.KEVA_PUBLIC_API_HOST);
    if (publicApiRequest instanceof Response) return publicApiRequest;
    const url = new URL(publicApiRequest.url);
    if (!isServerPath(url.pathname) && env.ASSETS) {
      const response = await env.ASSETS.fetch(publicApiRequest);
      return withBrowserSecurityHeaders(response, env.S3_ENDPOINT, url.pathname.startsWith("/s/"));
    }

    serverOptionsConfigFor(env);
    if (!app) app = makeApp();
    return app.fetch(publicApiRequest, env);
  },

  scheduled(_controller: unknown, env: Env, context: ExecutionContext): void {
    context.waitUntil(
      Promise.resolve()
        .then(() => runLifecycle(persistentConfigFor(env)))
        .then(
          (result) =>
            console.log(JSON.stringify({ event: "lifecycle.cleanup.completed", ...result })),
          () => console.error(JSON.stringify({ event: "lifecycle.cleanup.failed" })),
        ),
    );
  },
};
