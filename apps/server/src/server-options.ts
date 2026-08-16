import type { AppServiceOptions } from "./app.js";
import {
  betterAuthIdentityResolver,
  betterAuthSessionResolver,
  createBetterAuth,
  makeAuthHandler,
  type BetterAuthConfig,
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
import { StorageUnavailable } from "@keva/schema";
import { Polar } from "@polar-sh/sdk";
import { Effect, Exit } from "effect";
import { makeBillingStore, type BillingConfig, type BillingStore } from "./billing.js";
import { makeUserAvatarResolver } from "./avatar.js";
import { realtimePublisherLayer, type RealtimeGateway } from "./realtime.js";
import { failureOrElse } from "./effect-failure.js";

export interface ServerOptionsConfig {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly databaseUrl: string;
  readonly betterAuthSecret?: string;
  readonly betterAuthUrl?: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly emailVerification?: EmailVerificationConfig;
  readonly googleOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly requireLocalEmailVerified: boolean;
  };
  readonly polar?: BillingConfig & {
    readonly accessToken: string;
    readonly webhookSecret: string;
    readonly server: "sandbox" | "production";
  };
  readonly realtime: RealtimeGateway;
  readonly s3: RuntimeConfig["s3"];
}

interface BetterAuthConfigBuilder {
  database: BetterAuthConfig["database"];
  secret: string;
  baseURL: string;
  trustedOrigins?: NonNullable<BetterAuthConfig["trustedOrigins"]>;
  sendVerificationEmail?: NonNullable<BetterAuthConfig["sendVerificationEmail"]>;
  googleOAuth?: NonNullable<BetterAuthConfig["googleOAuth"]>;
  polar?: NonNullable<BetterAuthConfig["polar"]>;
}

interface RuntimeConfigBuilder {
  staticToken: string;
  tenantId: string;
  database: DatabaseUnit;
  sessionResolver?: NonNullable<RuntimeConfig["sessionResolver"]>;
  sessionIdentityResolver?: NonNullable<RuntimeConfig["sessionIdentityResolver"]>;
  billing?: BillingStore;
  realtime: RealtimeGateway;
  s3: RuntimeConfig["s3"];
}

interface AppServiceOptionsBuilder {
  layer: AppServiceOptions["layer"];
  changePublisher?: NonNullable<AppServiceOptions["changePublisher"]>;
  authHandler?: NonNullable<AppServiceOptions["authHandler"]>;
  billing?: NonNullable<AppServiceOptions["billing"]>;
  mcp?: NonNullable<AppServiceOptions["mcp"]>;
  userAvatars?: NonNullable<AppServiceOptions["userAvatars"]>;
  realtime?: NonNullable<AppServiceOptions["realtime"]>;
  dispose?: NonNullable<AppServiceOptions["dispose"]>;
}

const billingRefreshError = (message: string) => new StorageUnavailable({ message });

const refreshExpiredSubscription = Effect.fn("Billing.refreshExpiredSubscription")(function* (
  billing: BillingStore,
  polar: Polar,
  userId: string,
  tenantId: string,
) {
  const overview = yield* Effect.tryPromise({
    try: () => billing.getOverview(tenantId),
    catch: () => billingRefreshError("Billing status unavailable"),
  });
  const { currentPeriodEnd, subscriptionId } = overview.status;
  if (!subscriptionId || !currentPeriodEnd || new Date(currentPeriodEnd) > new Date()) return;
  const subscription = yield* Effect.tryPromise({
    try: () => polar.subscriptions.get({ id: subscriptionId }),
    catch: () => billingRefreshError("Subscription status unavailable"),
  });
  yield* Effect.tryPromise({
    try: () => billing.syncSubscription(userId, tenantId, subscription, new Date()),
    catch: () => billingRefreshError("Could not refresh subscription"),
  });
});

const databaseAuth = (config: ServerOptionsConfig, database: DatabaseUnit) => {
  if (!config.betterAuthSecret) return undefined;

  const billing: BillingStore | undefined = config.polar
    ? makeBillingStore(database.sql, config.polar)
    : undefined;
  const polarClient = config.polar
    ? new Polar({ accessToken: config.polar.accessToken, server: config.polar.server })
    : undefined;

  const authConfig: BetterAuthConfigBuilder = {
    database: database.db,
    secret: config.betterAuthSecret,
    baseURL: config.betterAuthUrl ?? config.baseUrl,
  };
  if (config.trustedOrigins) authConfig.trustedOrigins = config.trustedOrigins;
  if (config.emailVerification) {
    authConfig.sendVerificationEmail = createVerificationEmailSender(config.emailVerification);
  }
  if (config.googleOAuth) authConfig.googleOAuth = config.googleOAuth;
  if (config.polar && polarClient && billing) {
    authConfig.polar = {
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
    };
  }
  const auth = createBetterAuth(authConfig);

  const result = {
    auth,
    handler: makeAuthHandler(auth, database.db, config.betterAuthUrl ?? config.baseUrl),
    billing,
    polar: polarClient,
  };
  return result;
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
  const runtimeConfig: RuntimeConfigBuilder = {
    staticToken: config.staticToken,
    tenantId: config.tenantId,
    database,
    realtime: config.realtime,
    s3: config.s3,
  };
  if (sessionResolver) runtimeConfig.sessionResolver = sessionResolver;
  if (sessionIdentityResolver) {
    runtimeConfig.sessionIdentityResolver = sessionIdentityResolver;
  }
  if (auth?.billing) runtimeConfig.billing = auth.billing;
  const layer = makeRuntimeLayer(runtimeConfig);

  const options: AppServiceOptionsBuilder = {
    layer,
    changePublisher: realtimePublisherLayer(config.realtime),
    realtime: config.realtime,
    userAvatars: makeUserAvatarResolver(database.db),
    dispose: database.dispose,
  };
  if (!auth) return options;
  options.authHandler = auth.handler;
  if (auth.billing && auth.polar) {
    options.billing = { store: auth.billing, polar: auth.polar };
  }
  options.mcp = {
    mcpUrl: `${(config.betterAuthUrl ?? config.baseUrl).replace(/\/$/, "")}/mcp`,
    authorizationServer: makeMcpAuthorizationServer(auth.auth),
    resolveTenant: async (userId) => {
      const tenantId = await makeUserTenantResolver(database.db)(userId);
      if (tenantId && auth.billing) {
        await auth.billing.ensureUnsubscribed(userId, tenantId);
        if (auth.polar) {
          const refresh = await Effect.runPromiseExit(
            refreshExpiredSubscription(auth.billing, auth.polar, userId, tenantId),
          );
          if (Exit.isFailure(refresh)) {
            throw failureOrElse(refresh.cause, () =>
              billingRefreshError("Could not refresh subscription"),
            );
          }
        }
      }
      return tenantId;
    },
    resolveActorNames: makeMcpActorResolver(database.db),
    connections: makeConnectionStore(database.db),
  };
  return options;
};
