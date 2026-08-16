import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import { Layer } from "effect";
import {
  ApiTokenStore,
  TokenAndStaticAuthFromStoreLive,
  makePostgresApiTokenStore,
  type SessionIdentityResolver,
  type SessionResolver,
} from "./auth.js";
import { ShareGrantStore, makePostgresShareGrantStore } from "./shares.js";
import { makePostgresViewStore, ViewStore } from "./views.js";
import type { DatabaseUnit } from "./database.js";
import type { BillingStore } from "./billing.js";
import type { RealtimeGateway } from "./realtime.js";

interface AuthLayerConfig {
  staticToken: string;
  tenantId: string;
  sessionResolver?: SessionResolver;
  sessionIdentityResolver?: SessionIdentityResolver;
}

export interface RuntimeConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly database: DatabaseUnit;
  readonly sessionResolver?: SessionResolver;
  readonly sessionIdentityResolver?: SessionIdentityResolver;
  readonly billing?: BillingStore;
  readonly realtime: RealtimeGateway;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
  };
}

export const makeRuntimeLayer = (config: RuntimeConfig) => {
  const sql = config.database.sql;
  const metadata = Layer.succeed(MetadataStore, makePostgresMetadataStore(sql));
  const blobs = S3BlobStoreLive(config.s3);
  const stores = Layer.mergeAll(
    Layer.succeed(ApiTokenStore, makePostgresApiTokenStore(sql)),
    Layer.succeed(ShareGrantStore, makePostgresShareGrantStore(sql)),
    Layer.succeed(ViewStore, makePostgresViewStore(sql)),
  );
  const authConfig: AuthLayerConfig = {
    staticToken: config.staticToken,
    tenantId: config.tenantId,
  };
  if (config.sessionResolver) authConfig.sessionResolver = config.sessionResolver;
  if (config.sessionIdentityResolver) {
    authConfig.sessionIdentityResolver = config.sessionIdentityResolver;
  }
  const authAndStores = Layer.provideMerge(TokenAndStaticAuthFromStoreLive(authConfig), stores);
  return Layer.mergeAll(metadata, blobs, authAndStores);
};
