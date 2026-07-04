import { createApp } from "./app.js";
import { trustedOriginsFor } from "./origins.js";
import { createServerOptions } from "./server-options.js";

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
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly S3_ENDPOINT?: string;
  readonly S3_REGION?: string;
  readonly S3_ACCESS_KEY_ID?: string;
  readonly S3_SECRET_ACCESS_KEY?: string;
  readonly S3_BUCKET?: string;
  readonly S3_FORCE_PATH_STYLE?: string;
}

let app: ReturnType<typeof createApp> | undefined;

const serverPaths = ["/api", "/mcp", "/.well-known", "/health", "/__dev"];

const isServerPath = (pathname: string): boolean =>
  serverPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!isServerPath(url.pathname) && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    const staticToken = required(env.KEVA_STATIC_TOKEN, "KEVA_STATIC_TOKEN");
    const baseUrl = required(env.KEVA_BASE_URL, "KEVA_BASE_URL");
    if (!app) {
      const s3 =
        env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET
          ? {
              endpoint: env.S3_ENDPOINT,
              region: env.S3_REGION ?? "us-east-1",
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              bucket: env.S3_BUCKET,
              forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
            }
          : undefined;
      const databaseUrl = env.HYPERDRIVE?.connectionString;
      app = createApp(
        createServerOptions({
          staticToken,
          tenantId: env.KEVA_TENANT_ID ?? "local",
          baseUrl,
          ...(databaseUrl ? { databaseUrl } : {}),
          ...(env.BETTER_AUTH_SECRET ? { betterAuthSecret: env.BETTER_AUTH_SECRET } : {}),
          ...(env.BETTER_AUTH_URL ? { betterAuthUrl: env.BETTER_AUTH_URL } : {}),
          trustedOrigins: trustedOriginsFor(baseUrl, env.KEVA_TRUSTED_ORIGINS),
          ...(s3 ? { s3 } : {}),
        }),
      );
    }
    return app.fetch(request);
  },
};
