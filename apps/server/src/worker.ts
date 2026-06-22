import { createApp } from "./app.js";
import { makeRuntimeLayer } from "./runtime.js";

interface Env {
  readonly KEVA_STATIC_TOKEN: string;
  readonly KEVA_TENANT_ID?: string;
  readonly KEVA_BASE_URL: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly S3_ENDPOINT?: string;
  readonly S3_REGION?: string;
  readonly S3_ACCESS_KEY_ID?: string;
  readonly S3_SECRET_ACCESS_KEY?: string;
  readonly S3_BUCKET?: string;
  readonly S3_FORCE_PATH_STYLE?: string;
}

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (!app) {
      const s3 = env.S3_ENDPOINT &&
          env.S3_ACCESS_KEY_ID &&
          env.S3_SECRET_ACCESS_KEY &&
          env.S3_BUCKET
        ? {
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION ?? "us-east-1",
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            bucket: env.S3_BUCKET,
            forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
          }
        : undefined;
      const layer = makeRuntimeLayer({
        staticToken: env.KEVA_STATIC_TOKEN,
        tenantId: env.KEVA_TENANT_ID ?? "local",
        baseUrl: env.KEVA_BASE_URL,
        ...(env.HYPERDRIVE
          ? { databaseUrl: env.HYPERDRIVE.connectionString }
          : {}),
        ...(s3 ? { s3 } : {}),
      });
      app = createApp({ layer });
    }
    return Promise.resolve(app.fetch(request));
  },
};
