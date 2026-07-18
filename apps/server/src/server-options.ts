import type { AppServiceOptions } from "./app.js";
import { makeAdminStore } from "./admin.js";
import {
  betterAuthSessionResolver,
  createBetterAuth,
  makeAuthHandler,
  makeConnectionStore,
  makeMcpActorResolver,
  makeMcpAuthorizationServer,
  makeUserTenantResolver,
} from "./better-auth.js";
import { makeRuntimeLayer, type RuntimeConfig } from "./runtime.js";
import { makeDatabaseUnit, type DatabaseUnit } from "./database.js";
import {
  createVerificationEmailSender,
  type EmailVerificationConfig,
} from "./email-verification.js";

export interface ServerOptionsConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly databaseUrl: string;
  readonly betterAuthSecret?: string;
  readonly betterAuthUrl?: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly emailVerification?: EmailVerificationConfig;
  readonly adminToken?: string;
  readonly s3: RuntimeConfig["s3"];
}

const databaseAuth = (config: ServerOptionsConfig, database: DatabaseUnit) => {
  if (!config.betterAuthSecret) return undefined;

  const auth = createBetterAuth({
    database: database.db,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl ?? config.baseUrl,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),
    ...(config.emailVerification
      ? { sendVerificationEmail: createVerificationEmailSender(config.emailVerification) }
      : {}),
  });

  return {
    auth,
    handler: makeAuthHandler(auth, database.db, config.betterAuthUrl ?? config.baseUrl),
  };
};

export const createServerOptions = (config: ServerOptionsConfig): AppServiceOptions => {
  const database = makeDatabaseUnit(config.databaseUrl);
  const auth = databaseAuth(config, database);
  const layer = makeRuntimeLayer({
    staticToken: config.staticToken,
    tenantId: config.tenantId,
    database,
    ...(auth ? { sessionResolver: betterAuthSessionResolver(auth.auth, database.db) } : {}),
    s3: config.s3,
  });

  return {
    layer,
    ...(auth
      ? {
          authHandler: auth.handler,
          ...(config.adminToken
            ? { admin: { token: config.adminToken, store: makeAdminStore(database.sql) } }
            : {}),
          mcp: {
            mcpUrl: `${(config.betterAuthUrl ?? config.baseUrl).replace(/\/$/, "")}/mcp`,
            authorizationServer: makeMcpAuthorizationServer(auth.auth),
            resolveTenant: makeUserTenantResolver(database.db),
            resolveActorNames: makeMcpActorResolver(database.db),
            connections: makeConnectionStore(database.db),
          },
        }
      : {}),
    dispose: database.dispose,
  };
};
