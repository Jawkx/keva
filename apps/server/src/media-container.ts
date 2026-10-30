import { Container, getContainer } from "@cloudflare/containers";

export interface MediaContainerEnvironment {
  readonly KEVA_ENVIRONMENT?: string;
  readonly MEDIA_DATABASE_URL?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly S3_ENDPOINT?: string;
  readonly S3_REGION?: string;
  readonly S3_ACCESS_KEY_ID?: string;
  readonly S3_SECRET_ACCESS_KEY?: string;
  readonly S3_BUCKET?: string;
  readonly S3_FORCE_PATH_STYLE?: string;
}

export interface MediaContainerConfig {
  readonly environment: string;
  readonly databaseUrl: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3Bucket: string;
  readonly s3ForcePathStyle: string;
}

export type MediaContainerStub = ReturnType<typeof getContainer<MediaContainer>>;
export type MediaContainerNamespace = Parameters<typeof getContainer<MediaContainer>>[0];

export class MediaContainer extends Container<MediaContainerEnvironment> {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15s";
  enableInternet = true;

  async fetchWithConfig(request: Request, config: MediaContainerConfig): Promise<Response> {
    this.envVars = {
      KEVA_ENVIRONMENT: config.environment,
      DATABASE_URL: config.databaseUrl,
      S3_ENDPOINT: config.s3Endpoint,
      S3_REGION: config.s3Region,
      S3_ACCESS_KEY_ID: config.s3AccessKeyId,
      S3_SECRET_ACCESS_KEY: config.s3SecretAccessKey,
      S3_BUCKET: config.s3Bucket,
      S3_FORCE_PATH_STYLE: config.s3ForcePathStyle,
      THUMBNAIL_RECIPE_VERSION: "1",
      THUMBNAIL_BATCH_SIZE: "5",
    };
    return this.containerFetch(request);
  }
}

export const mediaContainerFor = (
  namespace: MediaContainerNamespace,
  environment: string,
): MediaContainerStub => getContainer(namespace, `keva-media-${environment}`);
