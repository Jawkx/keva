import type { AppServiceOptions } from "./app.js";
import {
  betterAuthIdentityResolver,
  betterAuthSessionResolver,
  createBetterAuth,
  makeAuthHandler,
  makeConnectionStore,
  makeMcpActorResolver,
  makeMcpAuthorizationServer,
  makeUserTenantResolver,
  resolvePersonalOrganization,
} from "./better-auth.js";
import { makeRuntimeLayer, type RuntimeConfig } from "./runtime.js";
import { makeDatabaseUnit, type DatabaseUnit } from "./database.js";
import {
  createVerificationEmailSender,
  type EmailVerificationConfig,
} from "./email-verification.js";
import { Polar } from "@polar-sh/sdk";
import { makeBillingStore, type BillingConfig, type BillingStore } from "./billing.js";
import { makeUserAvatarResolver } from "./avatar.js";

export interface ServerOptionsConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly databaseUrl: string;
  readonly betterAuthSecret?: string;
  readonly betterAuthUrl?: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly emailVerification?: EmailVerificationConfig;
  readonly polar?: BillingConfig & {
    readonly accessToken: string;
    readonly webhookSecret: string;
    readonly server: "sandbox" | "production";
  };
  readonly s3: RuntimeConfig["s3"];
}

const databaseAuth = (config: ServerOptionsConfig, database: DatabaseUnit) => {
  if (!config.betterAuthSecret) return undefined;

  const billing: BillingStore | undefined = config.polar
    ? makeBillingStore(database.sql, config.polar)
    : undefined;
  const polarClient = config.polar
    ? new Polar({ accessToken: config.polar.accessToken, server: config.polar.server })
    : undefined;

  const auth = createBetterAuth({
    database: database.db,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl ?? config.baseUrl,
    ...(config.trustedOrigins ? { trustedOrigins: config.trustedOrigins } : {}),
    ...(config.emailVerification
      ? { sendVerificationEmail: createVerificationEmailSender(config.emailVerification) }
      : {}),
    ...(config.polar && polarClient && billing
      ? {
          polar: {
            client: polarClient,
            webhookSecret: config.polar.webhookSecret,
            products: Object.entries(config.polar.products).map(([slug, productId]) => ({
              slug,
              productId,
            })),
            onSubscription: async (subscription, eventAt) => {
              const userId = subscription.customer.externalId;
              if (!userId) return;
              const tenantId = await resolvePersonalOrganization(database.db, userId, userId);
              if (!tenantId) return;
              await billing.syncSubscription(userId, tenantId, subscription, eventAt);
            },
          },
        }
      : {}),
  });

  return {
    auth,
    handler: makeAuthHandler(auth, database.db, config.betterAuthUrl ?? config.baseUrl),
    ...(billing && polarClient ? { billing, polar: polarClient } : {}),
  };
};

export const createServerOptions = (config: ServerOptionsConfig): AppServiceOptions => {
  const database = makeDatabaseUnit(config.databaseUrl);
  const auth = databaseAuth(config, database);
  const baseSessionResolver = auth ? betterAuthSessionResolver(auth.auth, database.db) : undefined;
  const sessionIdentityResolver = auth ? betterAuthIdentityResolver(auth.auth) : undefined;
  const sessionResolver =
    auth && baseSessionResolver
      ? async (headers: Headers) => {
          const session = await baseSessionResolver(headers);
          if (session?.user && auth.billing) {
            await auth.billing.ensureUnsubscribed(session.user.id, session.tenantId);
          }
          return session;
        }
      : undefined;
  const layer = makeRuntimeLayer({
    staticToken: config.staticToken,
    tenantId: config.tenantId,
    database,
    ...(sessionResolver ? { sessionResolver } : {}),
    ...(sessionIdentityResolver ? { sessionIdentityResolver } : {}),
    ...(auth?.billing ? { billing: auth.billing } : {}),
    s3: config.s3,
  });

  return {
    layer,
    userAvatars: makeUserAvatarResolver(database.db),
    ...(auth
      ? {
          authHandler: auth.handler,
          ...(auth.billing && auth.polar
            ? { billing: { store: auth.billing, polar: auth.polar } }
            : {}),
          mcp: {
            mcpUrl: `${(config.betterAuthUrl ?? config.baseUrl).replace(/\/$/, "")}/mcp`,
            authorizationServer: makeMcpAuthorizationServer(auth.auth),
            resolveTenant: async (userId) => {
              const tenantId = await makeUserTenantResolver(database.db)(userId);
              if (tenantId && auth.billing) await auth.billing.ensureUnsubscribed(userId, tenantId);
              return tenantId;
            },
            resolveActorNames: makeMcpActorResolver(database.db),
            connections: makeConnectionStore(database.db),
          },
        }
      : {}),
    dispose: database.dispose,
  };
};
