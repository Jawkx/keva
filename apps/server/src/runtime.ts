import {
  MemoryBlobStoreLive,
  MemoryMetadataStoreLive,
  PostgresMetadataStoreLive,
  S3BlobStoreLive,
} from "@keva/core";
import { StorageUnavailable } from "@keva/schema";
import { Effect, Layer } from "effect";
import {
  ApiTokenStore,
  PostgresApiTokenStoreLive,
  StaticTokenAuthLive,
  TokenAndStaticAuthFromStoreLive,
  type ApiTokenStoreService,
  type SessionResolver,
} from "./auth.js";
import {
  PostgresShareGrantStoreLive,
  ShareGrantStore,
  type ShareGrantStoreService,
} from "./shares.js";

// Without Postgres there is no token store. `resolve` simply finds no token (so
// auth falls through to the static token); the mutating ops fail with a typed
// StorageUnavailable rather than an untyped defect. In practice these are
// unreachable in no-DB mode — /tokens requires an admin session, which needs a DB.
const tokensNeedDatabase = () =>
  Effect.fail(new StorageUnavailable({ message: "API tokens require a database" }));

const unavailableTokenStore: ApiTokenStoreService = {
  resolve: () => Effect.succeed(null),
  mint: tokensNeedDatabase,
  list: tokensNeedDatabase,
  revoke: tokensNeedDatabase,
};

// Same rationale for share grants: no Postgres means `resolve` finds nothing
// (a `keva_sh_` token 401s) and management ops surface StorageUnavailable.
// Unreachable in practice — share management requires an admin session (a DB).
const sharesNeedDatabase = () =>
  Effect.fail(new StorageUnavailable({ message: "Share grants require a database" }));

const unavailableShareStore: ShareGrantStoreService = {
  resolve: () => Effect.succeed(null),
  create: sharesNeedDatabase,
  list: sharesNeedDatabase,
  get: sharesNeedDatabase,
  revoke: sharesNeedDatabase,
};

export interface RuntimeConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  /**
   * Base URL the dev-loopback blob store embeds in presigned URLs. Set to ""
   * to emit relative URLs (`/__dev/blobs/...`) so a same-origin dev proxy (e.g.
   * the web app's Vite proxy) can forward them and cookies stay first-party.
   * Defaults to `baseUrl`. No effect once S3 is configured.
   */
  readonly loopbackBaseUrl?: string;
  readonly databaseUrl?: string;
  readonly sessionResolver?: SessionResolver;
  readonly s3?: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
  };
}

export const makeRuntimeLayer = (config: RuntimeConfig) => {
  const metadata = config.databaseUrl
    ? PostgresMetadataStoreLive({ url: config.databaseUrl })
    : MemoryMetadataStoreLive;
  const blobs = config.s3
    ? S3BlobStoreLive(config.s3)
    : MemoryBlobStoreLive({
        baseUrl: config.loopbackBaseUrl !== undefined ? config.loopbackBaseUrl : config.baseUrl,
      });
  const tokens = config.databaseUrl
    ? PostgresApiTokenStoreLive(config.databaseUrl)
    : Layer.succeed(ApiTokenStore, unavailableTokenStore);
  const shares = config.databaseUrl
    ? PostgresShareGrantStoreLive(config.databaseUrl)
    : Layer.succeed(ShareGrantStore, unavailableShareStore);
  const authAndStores = config.databaseUrl
    ? Layer.provideMerge(
        TokenAndStaticAuthFromStoreLive({
          staticToken: config.staticToken,
          tenantId: config.tenantId,
          ...(config.sessionResolver ? { sessionResolver: config.sessionResolver } : {}),
        }),
        Layer.merge(tokens, shares),
      )
    : Layer.merge(
        Layer.merge(tokens, shares),
        StaticTokenAuthLive({
          token: config.staticToken,
          tenantId: config.tenantId,
        }),
      );
  return Layer.mergeAll(metadata, blobs, authAndStores);
};
