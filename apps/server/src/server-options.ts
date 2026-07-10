import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppServiceOptions } from "./app.js";
import * as authSchema from "./auth-schema.js";
import {
  betterAuthSessionResolver,
  createBetterAuth,
  makeConnectionStore,
  makeMcpActorResolver,
  makeMcpAuthorizationServer,
  makeUserTenantResolver,
} from "./better-auth.js";
import { makeRuntimeLayer, type RuntimeConfig } from "./runtime.js";

export interface ServerOptionsConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly loopbackBaseUrl?: string;
  readonly databaseUrl?: string;
  readonly betterAuthSecret?: string;
  readonly betterAuthUrl?: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly s3?: RuntimeConfig["s3"];
}

const databaseAuth = (config: ServerOptionsConfig) => {
  if (!config.databaseUrl || !config.betterAuthSecret) return undefined;

  const sql = postgres(config.databaseUrl);
  const db = drizzle(sql, { schema: authSchema });
  const auth = createBetterAuth({
    database: db,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl ?? config.baseUrl,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),
  });

  return { auth, db, dispose: () => sql.end({ timeout: 5 }) };
};

export const createServerOptions = (config: ServerOptionsConfig): AppServiceOptions => {
  const auth = databaseAuth(config);
  const layer = makeRuntimeLayer({
    staticToken: config.staticToken,
    tenantId: config.tenantId,
    baseUrl: config.baseUrl,
    ...(config.loopbackBaseUrl !== undefined ? { loopbackBaseUrl: config.loopbackBaseUrl } : {}),
    ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
    ...(auth ? { sessionResolver: betterAuthSessionResolver(auth.auth) } : {}),
    ...(config.s3 ? { s3: config.s3 } : {}),
  });

  return {
    layer,
    ...(auth
      ? {
          authHandler: auth.auth.handler,
          mcp: {
            authorizationServer: makeMcpAuthorizationServer(auth.auth),
            resolveTenant: makeUserTenantResolver(auth.db),
            resolveActorNames: makeMcpActorResolver(auth.db),
            connections: makeConnectionStore(auth.db),
          },
          dispose: auth.dispose,
        }
      : {}),
  };
};
