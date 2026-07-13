import { MetadataStore, S3BlobStoreLive, makePostgresMetadataStore } from "@keva/core";
import { Layer } from "effect";
import {
  ApiTokenStore,
  TokenAndStaticAuthFromStoreLive,
  makePostgresApiTokenStore,
  type SessionResolver,
} from "./auth.js";
import { ShareGrantStore, makePostgresShareGrantStore } from "./shares.js";
import { makePostgresViewStore, ViewStore } from "./views.js";
import type { DatabaseUnit } from "./database.js";

export interface RuntimeConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly database: DatabaseUnit;
  readonly sessionResolver?: SessionResolver;
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
  const authAndStores = Layer.provideMerge(
    TokenAndStaticAuthFromStoreLive({
      staticToken: config.staticToken,
      tenantId: config.tenantId,
      ...(config.sessionResolver ? { sessionResolver: config.sessionResolver } : {}),
    }),
    stores,
  );
  return Layer.mergeAll(metadata, blobs, authAndStores);
};
