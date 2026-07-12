import type { AppServiceOptions } from "./app.js";
import { makeAdminStore } from "./admin.js";
import {
  betterAuthSessionResolver,
  createBetterAuth,
  makeConnectionStore,
  makeMcpActorResolver,
  makeMcpAuthorizationServer,
  makeUserTenantResolver,
} from "./better-auth.js";
import { makeRuntimeLayer, type RuntimeConfig } from "./runtime.js";
import type { RuntimeMode } from "./runtime-mode.js";
import { makeDatabaseUnit, type DatabaseUnit } from "./database.js";

export interface ServerOptionsConfig {
  readonly mode: RuntimeMode;
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly loopbackBaseUrl?: string;
  readonly databaseUrl?: string;
  readonly betterAuthSecret?: string;
  readonly betterAuthUrl?: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly adminToken?: string;
  readonly s3?: RuntimeConfig["s3"];
}

const databaseAuth = (config: ServerOptionsConfig, database: DatabaseUnit) => {
  if (!config.betterAuthSecret) return undefined;

  const auth = createBetterAuth({
    database: database.db,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl ?? config.baseUrl,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),
  });

  return { auth };
};

export const createServerOptions = (config: ServerOptionsConfig): AppServiceOptions => {
  if (config.mode === "persistent" && (!config.databaseUrl || !config.s3)) {
    throw new Error("Persistent runtime requires database and S3 configuration");
  }
  if (config.mode === "local-memory" && (config.databaseUrl || config.s3)) {
    throw new Error("Local-memory runtime cannot use database or S3 configuration");
  }

  const database = config.databaseUrl ? makeDatabaseUnit(config.databaseUrl) : undefined;
  const auth = database ? databaseAuth(config, database) : undefined;
  const layer = makeRuntimeLayer({
    mode: config.mode,
    staticToken: config.staticToken,
    tenantId: config.tenantId,
    baseUrl: config.baseUrl,
    ...(config.loopbackBaseUrl !== undefined ? { loopbackBaseUrl: config.loopbackBaseUrl } : {}),
    ...(database ? { database } : {}),
    ...(auth ? { sessionResolver: betterAuthSessionResolver(auth.auth, database!.db) } : {}),
    ...(config.s3 ? { s3: config.s3 } : {}),
  });

  return {
    layer,
    ...(auth && database
      ? {
          authHandler: auth.auth.handler,
          ...(config.adminToken && database
            ? { admin: { token: config.adminToken, store: makeAdminStore(database.sql) } }
            : {}),
          mcp: {
            authorizationServer: makeMcpAuthorizationServer(auth.auth),
            resolveTenant: makeUserTenantResolver(database.db),
            resolveActorNames: makeMcpActorResolver(database.db),
            connections: makeConnectionStore(database.db),
          },
        }
      : {}),
    ...(database ? { dispose: database.dispose } : {}),
  };
};
