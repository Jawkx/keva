import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { items } from "@keva/core/postgres";
import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import type { Polar } from "@polar-sh/sdk";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  anonymous,
  mcp,
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
  organization,
  withMcpAuth,
} from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { Option, Schema } from "effect";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SessionResolver } from "./auth.js";
import { serializeAvatarRecipe } from "./avatar.js";
import * as authSchema from "./auth-schema.js";
import * as mcpConnectionSchema from "./mcp-connection-schema.js";

export interface BetterAuthConfig {
  readonly database: PostgresJsDatabase<any>;
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
  readonly sendVerificationEmail?: (input: {
    readonly email: string;
    readonly url: string;
  }) => Promise<void>;
  readonly googleOAuth?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly requireLocalEmailVerified: boolean;
  };
  readonly polar?: {
    readonly client: Polar;
    readonly webhookSecret: string;
    readonly products: ReadonlyArray<{ readonly productId: string; readonly slug: string }>;
    readonly onSubscription: (subscription: Subscription, eventAt: Date) => Promise<void>;
  };
}

export const personalOrganizationSlug = (userId: string): string => `keva-${userId}`;

// A deterministic id so a self-healing owner-membership insert dedupes on the
// primary key (the member table has no unique (org, user) constraint).
const ownerMembershipId = (organizationId: string, userId: string): string =>
  `owner:${organizationId}:${userId}`;

export const resolvePersonalOrganization = async (
  db: PostgresJsDatabase<typeof authSchema>,
  userId: string,
  label: string,
): Promise<string | null> => {
  const slug = personalOrganizationSlug(userId);
  const ownerId = async (organizationId: string): Promise<string | null> => {
    const owner = await db
      .select({ organizationId: authSchema.member.organizationId })
      .from(authSchema.member)
      .where(
        and(
          eq(authSchema.member.organizationId, organizationId),
          eq(authSchema.member.userId, userId),
          eq(authSchema.member.role, "owner"),
        ),
      )
      .limit(1);
    return owner[0]?.organizationId ?? null;
  };

  const existing = await db
    .select({ id: authSchema.organization.id })
    .from(authSchema.organization)
    .where(eq(authSchema.organization.slug, slug))
    .limit(1);

  // Steady state: the org and its owner membership already exist. Stay
  // read-only so an authenticated request performs no writes.
  if (existing[0]) {
    const resolved = await ownerId(existing[0].id);
    if (resolved) return resolved;
  }

  // Create and/or heal in one transaction. Both inserts are idempotent (org by
  // unique slug, member by deterministic id), so a crash that leaves the org
  // without its owner membership is repaired on the next login instead of
  // locking the user out.
  return db.transaction(async (tx) => {
    await tx
      .insert(authSchema.organization)
      .values({ id: crypto.randomUUID(), name: `${label}'s space`, slug, createdAt: new Date() })
      .onConflictDoNothing();
    const organization = await tx
      .select({ id: authSchema.organization.id })
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, slug))
      .limit(1);
    const organizationId = organization[0]?.id;
    if (!organizationId) return null;
    await tx
      .insert(authSchema.member)
      .values({
        id: ownerMembershipId(organizationId, userId),
        organizationId,
        userId,
        role: "owner",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    return organizationId;
  });
};

export const KEVA_MCP_SCOPES = [
  "keva:read",
  "keva:write",
  "keva:delete",
  "keva:views",
  "keva:shares",
] as const;

const MCP_OAUTH_SCOPES = ["openid", "profile", "email", "offline_access", ...KEVA_MCP_SCOPES];

const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const isAllowedMcpRedirectUri = (value: string): boolean => {
  if (value.length > 2048 || value.includes(",")) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") return isLoopbackHost(url.hostname);
    return !["data:", "file:", "javascript:", "vbscript:"].includes(url.protocol);
  } catch {
    return false;
  }
};

type BetterAuthMcpRuntime = Parameters<typeof withMcpAuth>[0] &
  Parameters<typeof oAuthDiscoveryMetadata>[0] &
  Parameters<typeof oAuthProtectedResourceMetadata>[0];

interface OrganizationApi {
  readonly listOrganizations: (input: {
    headers: Headers;
  }) => Promise<ReadonlyArray<{ id: string }>>;
  readonly createOrganization: (input: {
    headers: Headers;
    body: { name: string; slug: string };
  }) => Promise<{ id: string } | null>;
  readonly setActiveOrganization: (input: {
    headers: Headers;
    body: { organizationId: string };
  }) => Promise<void>;
}

interface AuthApiSession {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly isAnonymous: boolean | null | undefined;
  };
  readonly session: { readonly activeOrganizationId: string | null | undefined };
}

interface KevaAuthApi {
  readonly organization: OrganizationApi;
  readonly getSession: (input: { headers: Headers }) => Promise<AuthApiSession | null>;
}

export type KevaAuth = BetterAuthMcpRuntime & {
  readonly handler: (request: Request) => Promise<Response>;
  readonly kevaApi: KevaAuthApi;
};

export const createBetterAuth = (config: BetterAuthConfig): KevaAuth => {
  const sendVerificationEmail = config.sendVerificationEmail;
  const polarConfig = config.polar;
  const options = {
    database: drizzleAdapter(config.database, {
      provider: "pg",
      schema: authSchema,
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins ? [...config.trustedOrigins] : [],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: Boolean(config.sendVerificationEmail),
    },

    user: {
      additionalFields: {
        avatar: {
          type: "string",
          required: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.avatar === undefined || user.avatar === null) return { data: user };
            try {
              return { data: { ...user, avatar: serializeAvatarRecipe(user.avatar) } };
            } catch {
              throw new APIError("BAD_REQUEST", { message: "Invalid avatar" });
            }
          },
        },
        update: {
          before: async (user) => {
            if (user.avatar === undefined || user.avatar === null) return { data: user };
            try {
              return { data: { ...user, avatar: serializeAvatarRecipe(user.avatar) } };
            } catch {
              throw new APIError("BAD_REQUEST", { message: "Invalid avatar" });
            }
          },
        },
      },
    },

    experimental: { joins: true },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/mcp/register") return;
        const decodedBody = Schema.decodeUnknownOption(
          Schema.Record(Schema.String, Schema.Unknown),
        )(context.body);
        if (Option.isNone(decodedBody)) {
          throw new APIError("BAD_REQUEST", { message: "Invalid OAuth redirect URI" });
        }
        const body = decodedBody.value;
        const redirectUris = Schema.decodeUnknownOption(Schema.Array(Schema.String))(
          body.redirect_uris,
        );
        if (
          Option.isNone(redirectUris) ||
          redirectUris.value.length === 0 ||
          redirectUris.value.length > 10 ||
          redirectUris.value.some((value) => !isAllowedMcpRedirectUri(value))
        ) {
          throw new APIError("BAD_REQUEST", { message: "Invalid OAuth redirect URI" });
        }
        const clientName = Schema.decodeUnknownOption(Schema.String)(body.client_name);
        const suppliedName = Option.isSome(clientName) ? clientName.value.trim() : "";
        return {
          context: {
            body: {
              ...body,
              client_name: suppliedName.slice(0, 120) || "MCP Client",
            },
          },
        };
      }),
    },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await config.database
            .update(items)
            .set({ uploadedByUserId: newUser.user.id })
            .where(eq(items.uploadedByUserId, anonymousUser.user.id));
        },
      }),
      organization(),
      ...(polarConfig
        ? [
            polar({
              client: polarConfig.client,
              createCustomerOnSignUp: true,
              use: [
                checkout({
                  products: [...polarConfig.products],
                  successUrl: `${config.baseURL.replace(/\/$/, "")}/settings?checkout=complete`,
                  returnUrl: `${config.baseURL.replace(/\/$/, "")}/settings`,
                  authenticatedUsersOnly: true,
                }),
                portal({ returnUrl: `${config.baseURL.replace(/\/$/, "")}/settings` }),
                webhooks({
                  secret: polarConfig.webhookSecret,
                  onSubscriptionCreated: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                  onSubscriptionUpdated: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                  onSubscriptionActive: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                  onSubscriptionCanceled: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                  onSubscriptionRevoked: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                  onSubscriptionUncanceled: (payload) =>
                    polarConfig.onSubscription(payload.data, payload.timestamp),
                }),
              ],
            }),
          ]
        : []),
      mcp({
        loginPage: "/login",
        resource: `${config.baseURL.replace(/\/$/, "")}/mcp`,
        oidcConfig: {
          // Overridden by the top-level `loginPage` at runtime; required here
          // only to satisfy the OIDCOptions type.
          loginPage: "/login",
          consentPage: "/oauth/consent",
          allowDynamicClientRegistration: true,
          requirePKCE: true,
          allowPlainCodeChallengeMethod: false,
          // Merged after the plugin's openid/profile/email/offline_access set.
          scopes: [...KEVA_MCP_SCOPES],
          // The protected-resource metadata advertises scopes from
          // metadata.scopes_supported and does NOT inherit `scopes`, so MCP
          // clients discover keva:* only if it is listed here too.
          metadata: {
            scopes_supported: MCP_OAUTH_SCOPES,
          },
        },
      }),
    ],
  } satisfies BetterAuthOptions;
  if (config.googleOAuth) {
    Object.assign(options, {
      socialProviders: {
        google: {
          clientId: config.googleOAuth.clientId,
          clientSecret: config.googleOAuth.clientSecret,
        },
      },
      account: {
        accountLinking: {
          enabled: true,
          disableImplicitLinking: false,
          requireLocalEmailVerified: config.googleOAuth.requireLocalEmailVerified,
          allowDifferentEmails: false,
        },
      },
    });
  }
  if (sendVerificationEmail) {
    Object.assign(options, {
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: false,
        autoSignInAfterVerification: true,
        sendVerificationEmail: ({ user, url }: { user: { email: string }; url: string }) =>
          sendVerificationEmail({ email: user.email, url }),
      },
    });
  }
  const auth = betterAuth(options);
  const organizationApiAdapter: OrganizationApi = {
    listOrganizations: (input) => auth.api.listOrganizations(input),
    createOrganization: (input) => auth.api.createOrganization(input),
    setActiveOrganization: async (input) => {
      await auth.api.setActiveOrganization(input);
    },
  };
  return Object.assign(auth, {
    kevaApi: {
      organization: organizationApiAdapter,
      getSession: async (input: { headers: Headers }) => {
        const result = await auth.api.getSession(input);
        if (!result) return null;
        return {
          user: {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            isAnonymous: result.user.isAnonymous,
          },
          session: { activeOrganizationId: result.session.activeOrganizationId },
        };
      },
    },
  });
};

export interface BetterAuthSessionApi {
  readonly getSession: (input: { headers: Headers }) => Promise<{ user: { id: string } } | null>;
}

export interface McpOAuthSession {
  readonly userId: string;
  readonly scopes: string;
  readonly clientId: string;
}

export interface McpAuthorizationServer {
  readonly authorizationServerMetadata: (request: Request) => Response | Promise<Response>;
  readonly protectedResourceMetadata: (request: Request) => Response | Promise<Response>;
  readonly withMcpAuth: (
    handler: (request: Request, session: McpOAuthSession) => Response | Promise<Response>,
  ) => (request: Request) => Response | Promise<Response>;
  readonly sessionApi: BetterAuthSessionApi;
}

export const makeAuthHandler =
  (
    auth: KevaAuth,
    db: PostgresJsDatabase<typeof authSchema>,
    baseURL: string,
  ): ((request: Request) => Promise<Response>) =>
  async (request) => {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/auth/mcp/authorize") {
      return auth.handler(request);
    }

    const session = await auth.kevaApi.getSession({ headers: request.headers });
    if (!session) {
      const login = new URL("/login", baseURL);
      login.search = url.search;
      return Response.redirect(login, 302);
    }

    const clientId = url.searchParams.get("client_id");
    if (clientId && url.searchParams.get("prompt") !== "consent") {
      const requestedScopes = new Set(
        (url.searchParams.get("scope") ?? "openid").split(/\s+/).filter(Boolean),
      );
      const consents = await db
        .select({ scopes: authSchema.oauthConsent.scopes })
        .from(authSchema.oauthConsent)
        .where(
          and(
            eq(authSchema.oauthConsent.userId, session.user.id),
            eq(authSchema.oauthConsent.clientId, clientId),
            eq(authSchema.oauthConsent.consentGiven, true),
          ),
        );
      const grantedScopes = new Set(
        consents.flatMap((consent) => consent.scopes.split(/\s+/).filter(Boolean)),
      );
      if ([...requestedScopes].some((scope) => !grantedScopes.has(scope))) {
        url.searchParams.set("prompt", "consent");
        request = new Request(url, request);
      }
    }

    return auth.handler(request);
  };

const organizationApi = (auth: KevaAuth): OrganizationApi => auth.kevaApi.organization;

export const betterAuthSessionApi = (auth: KevaAuth): BetterAuthSessionApi => ({
  getSession: async (input) => {
    const session = await auth.kevaApi.getSession(input);
    return session ? { user: { id: session.user.id } } : null;
  },
});

export const makeMcpAuthorizationServer = (auth: KevaAuth): McpAuthorizationServer => {
  const runtime: BetterAuthMcpRuntime = auth;
  const authorizationServerMetadata = oAuthDiscoveryMetadata(runtime);
  return {
    authorizationServerMetadata: async (request) => {
      const response = await authorizationServerMetadata(request);
      if (!response.ok) return response;
      const metadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
        await response.json(),
      );
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return Response.json(
        { ...metadata, scopes_supported: MCP_OAUTH_SCOPES },
        { status: response.status, headers },
      );
    },
    protectedResourceMetadata: oAuthProtectedResourceMetadata(runtime),
    withMcpAuth: (handler) =>
      withMcpAuth(runtime, (request, session) =>
        handler(request, {
          userId: session.userId,
          scopes: session.scopes,
          clientId: session.clientId,
        }),
      ),
    sessionApi: betterAuthSessionApi(auth),
  };
};

type ResolvedAuthUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly isAnonymous?: boolean | undefined;
};

interface ResolvedAuthSession {
  readonly user: ResolvedAuthUser;
  readonly session: { readonly activeOrganizationId?: string | null };
}

const authSession = async (
  auth: KevaAuth,
  headers: Headers,
): Promise<ResolvedAuthSession | null> => {
  const result = await auth.kevaApi.getSession({ headers });
  if (!result) return null;
  return {
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      isAnonymous: Boolean(result.user.isAnonymous),
    },
    session:
      result.session.activeOrganizationId === undefined
        ? {}
        : { activeOrganizationId: result.session.activeOrganizationId },
  };
};

export const betterAuthIdentityResolver = (auth: KevaAuth) => async (headers: Headers) => {
  const result = await authSession(auth, headers);
  if (!result) return null;
  return {
    id: result.user.id,
    name: result.user.isAnonymous ? "Guest" : result.user.name?.trim() || result.user.email,
    isAnonymous: Boolean(result.user.isAnonymous),
  };
};

export const betterAuthSessionResolver =
  (auth: KevaAuth, db: PostgresJsDatabase<typeof authSchema>): SessionResolver =>
  async (headers) => {
    const result = await authSession(auth, headers);
    if (!result || result.user.isAnonymous) return null;

    const tenantId = await resolvePersonalOrganization(
      db,
      result.user.id,
      result.user.name?.trim() || result.user.email,
    );
    if (!tenantId) return null;
    // Only write the session when the active organization actually changes, so
    // a steady-state authenticated request performs no session write.
    const activeOrganizationId = result.session.activeOrganizationId;
    if (activeOrganizationId !== tenantId) {
      await organizationApi(auth).setActiveOrganization({
        headers,
        body: { organizationId: tenantId },
      });
    }

    // A signed-in user currently controls their personal tenant fully.
    return {
      tenantId,
      scopes: ["read", "write", "delete", "admin"],
      user: {
        id: result.user.id,
        name: result.user.name?.trim() || result.user.email,
      },
    };
  };

// MCP tokens carry user identity, not active-organization session state.
export const makeUserTenantResolver =
  (db: PostgresJsDatabase<typeof authSchema>) =>
  async (userId: string): Promise<string | null> =>
    resolvePersonalOrganization(db, userId, "Personal");

// The client name is self-asserted via OAuth dynamic client registration —
// display-only, never an authorization input.
export interface McpActorNames {
  readonly userName: string | null;
  readonly clientName: string | null;
}

export const makeMcpActorResolver =
  (db: PostgresJsDatabase<typeof authSchema>) =>
  async (userId: string, clientId: string): Promise<McpActorNames> => {
    const [users, clients] = await Promise.all([
      db
        .select({ name: authSchema.user.name, email: authSchema.user.email })
        .from(authSchema.user)
        .where(eq(authSchema.user.id, userId))
        .limit(1),
      db
        .select({ name: authSchema.oauthApplication.name })
        .from(authSchema.oauthApplication)
        .where(eq(authSchema.oauthApplication.clientId, clientId))
        .limit(1),
    ]);
    return {
      userName: users[0] ? users[0].name?.trim() || users[0].email : null,
      clientName: clients[0]?.name ?? null,
    };
  };

export interface ConnectionSummary {
  readonly clientId: string;
  readonly name: string | null;
  readonly scopes: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly active: boolean;
  readonly observed: boolean;
  readonly lastSeenAt: string | null;
}

export interface ConnectionStore {
  readonly list: (userId: string) => Promise<ReadonlyArray<ConnectionSummary>>;
  readonly revoke: (userId: string, clientId: string) => Promise<boolean>;
  readonly observe: (userId: string, clientId: string) => Promise<void>;
  readonly clientName: (clientId: string) => Promise<string | null>;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export const makeConnectionStore = (
  db: PostgresJsDatabase<typeof authSchema & typeof mcpConnectionSchema>,
): ConnectionStore => ({
  list: async (userId) => {
    const [consents, tokens, activity] = await Promise.all([
      db
        .select({
          clientId: authSchema.oauthConsent.clientId,
          scopes: authSchema.oauthConsent.scopes,
          createdAt: authSchema.oauthConsent.createdAt,
          name: authSchema.oauthApplication.name,
        })
        .from(authSchema.oauthConsent)
        .leftJoin(
          authSchema.oauthApplication,
          eq(authSchema.oauthConsent.clientId, authSchema.oauthApplication.clientId),
        )
        .where(
          and(
            eq(authSchema.oauthConsent.userId, userId),
            eq(authSchema.oauthConsent.consentGiven, true),
          ),
        ),
      db
        .select({
          clientId: authSchema.oauthAccessToken.clientId,
          scopes: authSchema.oauthAccessToken.scopes,
          createdAt: authSchema.oauthAccessToken.createdAt,
          accessTokenExpiresAt: authSchema.oauthAccessToken.accessTokenExpiresAt,
          refreshTokenExpiresAt: authSchema.oauthAccessToken.refreshTokenExpiresAt,
          name: authSchema.oauthApplication.name,
        })
        .from(authSchema.oauthAccessToken)
        .leftJoin(
          authSchema.oauthApplication,
          eq(authSchema.oauthAccessToken.clientId, authSchema.oauthApplication.clientId),
        )
        .where(eq(authSchema.oauthAccessToken.userId, userId)),
      db
        .select({
          clientId: mcpConnectionSchema.mcpConnectionActivity.clientId,
          firstSeenAt: mcpConnectionSchema.mcpConnectionActivity.firstSeenAt,
          lastSeenAt: mcpConnectionSchema.mcpConnectionActivity.lastSeenAt,
          name: authSchema.oauthApplication.name,
        })
        .from(mcpConnectionSchema.mcpConnectionActivity)
        .leftJoin(
          authSchema.oauthApplication,
          eq(
            mcpConnectionSchema.mcpConnectionActivity.clientId,
            authSchema.oauthApplication.clientId,
          ),
        )
        .where(eq(mcpConnectionSchema.mcpConnectionActivity.userId, userId)),
    ]);

    interface MutableConnection {
      clientId: string;
      name: string | null;
      scopes: Set<string>;
      createdAt: string;
      active: boolean;
      observed: boolean;
      lastSeenAt: string | null;
    }
    const connections = new Map<string, MutableConnection>();
    const connection = (clientId: string, name: string | null, createdAt: Date | string) => {
      const created = toIso(createdAt);
      const existing = connections.get(clientId);
      if (existing) {
        existing.name ??= name;
        if (created < existing.createdAt) existing.createdAt = created;
        return existing;
      }
      const next: MutableConnection = {
        clientId,
        name,
        scopes: new Set(),
        createdAt: created,
        active: false,
        observed: false,
        lastSeenAt: null,
      };
      connections.set(clientId, next);
      return next;
    };

    for (const row of consents) {
      const item = connection(row.clientId, row.name ?? null, row.createdAt);
      for (const scope of row.scopes.split(/\s+/).filter(Boolean)) item.scopes.add(scope);
    }
    const now = Date.now();
    for (const row of tokens) {
      const item = connection(row.clientId, row.name ?? null, row.createdAt);
      for (const scope of row.scopes.split(/\s+/).filter(Boolean)) item.scopes.add(scope);
      if (
        new Date(row.accessTokenExpiresAt).getTime() > now ||
        new Date(row.refreshTokenExpiresAt).getTime() > now
      ) {
        item.active = true;
      }
    }
    for (const row of activity) {
      const item = connection(row.clientId, row.name ?? null, row.firstSeenAt);
      item.observed = true;
      item.lastSeenAt = toIso(row.lastSeenAt);
    }

    return [...connections.values()]
      .sort((left, right) =>
        (right.lastSeenAt ?? right.createdAt).localeCompare(left.lastSeenAt ?? left.createdAt),
      )
      .map((item) => ({ ...item, scopes: [...item.scopes] }));
  },
  revoke: async (userId, clientId) => {
    return db.transaction(async (tx) => {
      const deletedTokens = await tx
        .delete(authSchema.oauthAccessToken)
        .where(
          and(
            eq(authSchema.oauthAccessToken.userId, userId),
            eq(authSchema.oauthAccessToken.clientId, clientId),
          ),
        )
        .returning({ clientId: authSchema.oauthAccessToken.clientId });
      const deletedConsents = await tx
        .delete(authSchema.oauthConsent)
        .where(
          and(
            eq(authSchema.oauthConsent.userId, userId),
            eq(authSchema.oauthConsent.clientId, clientId),
          ),
        )
        .returning({ clientId: authSchema.oauthConsent.clientId });
      const deletedActivity = await tx
        .delete(mcpConnectionSchema.mcpConnectionActivity)
        .where(
          and(
            eq(mcpConnectionSchema.mcpConnectionActivity.userId, userId),
            eq(mcpConnectionSchema.mcpConnectionActivity.clientId, clientId),
          ),
        )
        .returning({ clientId: mcpConnectionSchema.mcpConnectionActivity.clientId });
      return deletedTokens.length + deletedConsents.length + deletedActivity.length > 0;
    });
  },
  observe: async (userId, clientId) => {
    const now = new Date();
    await db
      .insert(mcpConnectionSchema.mcpConnectionActivity)
      .values({ userId, clientId, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [
          mcpConnectionSchema.mcpConnectionActivity.userId,
          mcpConnectionSchema.mcpConnectionActivity.clientId,
        ],
        set: { lastSeenAt: now },
      });
  },
  clientName: async (clientId) => {
    const clients = await db
      .select({ name: authSchema.oauthApplication.name })
      .from(authSchema.oauthApplication)
      .where(eq(authSchema.oauthApplication.clientId, clientId))
      .limit(1);
    return clients[0]?.name ?? null;
  },
});
