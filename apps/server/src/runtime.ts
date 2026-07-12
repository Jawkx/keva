import {
  MemoryBlobStoreLive,
  MemoryMetadataStoreLive,
  MetadataStore,
  S3BlobStoreLive,
  makePostgresMetadataStore,
} from "@keva/core";
import { StorageUnavailable } from "@keva/schema";
import { Effect, Layer } from "effect";
import {
  ApiTokenStore,
  StaticTokenAuthLive,
  TokenAndStaticAuthFromStoreLive,
  makePostgresApiTokenStore,
  type ApiTokenStoreService,
  type SessionResolver,
} from "./auth.js";
import {
  ShareGrantStore,
  makePostgresShareGrantStore,
  type ShareGrantStoreService,
} from "./shares.js";
import { makePostgresViewStore, unavailableViewStore, ViewStore } from "./views.js";
import type { DatabaseUnit } from "./database.js";
import type { RuntimeMode } from "./runtime-mode.js";

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
  updateView: sharesNeedDatabase,
};

export interface RuntimeConfig {
  readonly mode: RuntimeMode;
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
  readonly database?: DatabaseUnit;
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
  const persistent = config.mode === "persistent";
  if (persistent && (!config.database || !config.s3)) {
    throw new Error("Persistent runtime requires database and S3 configuration");
  }
  if (!persistent && (config.database || config.s3)) {
    throw new Error("Local-memory runtime cannot use database or S3 configuration");
  }

  const metadata = persistent
    ? Layer.succeed(MetadataStore, makePostgresMetadataStore(config.database!.sql))
    : MemoryMetadataStoreLive;
  const blobs = persistent
    ? S3BlobStoreLive(config.s3!)
    : MemoryBlobStoreLive({
        baseUrl: config.loopbackBaseUrl !== undefined ? config.loopbackBaseUrl : config.baseUrl,
      });
  const tokens = persistent
    ? Layer.succeed(ApiTokenStore, makePostgresApiTokenStore(config.database!.sql))
    : Layer.succeed(ApiTokenStore, unavailableTokenStore);
  const shares = persistent
    ? Layer.succeed(ShareGrantStore, makePostgresShareGrantStore(config.database!.sql))
    : Layer.succeed(ShareGrantStore, unavailableShareStore);
  const views = persistent
    ? Layer.succeed(ViewStore, makePostgresViewStore(config.database!.sql))
    : Layer.succeed(ViewStore, unavailableViewStore);
  const stores = Layer.mergeAll(tokens, shares, views);
  const authAndStores = persistent
    ? Layer.provideMerge(
        TokenAndStaticAuthFromStoreLive({
          staticToken: config.staticToken,
          tenantId: config.tenantId,
          ...(config.sessionResolver ? { sessionResolver: config.sessionResolver } : {}),
        }),
        stores,
      )
    : Layer.merge(
        stores,
        StaticTokenAuthLive({
          token: config.staticToken,
          tenantId: config.tenantId,
        }),
      );
  return Layer.mergeAll(metadata, blobs, authAndStores);
};
