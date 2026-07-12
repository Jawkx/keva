import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import {
  mcp,
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
  organization,
  withMcpAuth,
} from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SessionResolver } from "./auth.js";
import * as authSchema from "./auth-schema.js";

export interface BetterAuthConfig {
  readonly database: PostgresJsDatabase<any>;
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
}

export type KevaAuth = ReturnType<typeof betterAuth>;

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

export const KEVA_MCP_SCOPES = ["keva:read", "keva:write", "keva:delete"] as const;

export const createBetterAuth = (config: BetterAuthConfig): KevaAuth =>
  betterAuth({
    database: drizzleAdapter(config.database, {
      provider: "pg",
      schema: authSchema,
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins ? [...config.trustedOrigins] : [],
    emailAndPassword: { enabled: true },
    experimental: { joins: true },
    plugins: [
      organization(),
      mcp({
        loginPage: "/login",
        resource: `${config.baseURL.replace(/\/$/, "")}/mcp`,
        oidcConfig: {
          // Overridden by the top-level `loginPage` at runtime; required here
          // only to satisfy the OIDCOptions type.
          loginPage: "/login",
          consentPage: "/oauth/consent",
          allowDynamicClientRegistration: true,
          // Merged after the plugin's openid/profile/email/offline_access set.
          scopes: [...KEVA_MCP_SCOPES],
          // The protected-resource metadata advertises scopes from
          // metadata.scopes_supported and does NOT inherit `scopes`, so MCP
          // clients discover keva:* only if it is listed here too.
          metadata: {
            scopes_supported: ["openid", "profile", "email", "offline_access", ...KEVA_MCP_SCOPES],
          },
        },
      }),
    ],
  }) as unknown as KevaAuth;

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
  }) => Promise<unknown>;
}

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

type BetterAuthMcpRuntime = Parameters<typeof withMcpAuth>[0] &
  Parameters<typeof oAuthDiscoveryMetadata>[0] &
  Parameters<typeof oAuthProtectedResourceMetadata>[0];

const organizationApi = (auth: KevaAuth): OrganizationApi => auth.api as unknown as OrganizationApi;

export const betterAuthSessionApi = (auth: KevaAuth): BetterAuthSessionApi =>
  auth.api as unknown as BetterAuthSessionApi;

export const makeMcpAuthorizationServer = (auth: KevaAuth): McpAuthorizationServer => {
  const runtime = auth as unknown as BetterAuthMcpRuntime;
  return {
    authorizationServerMetadata: oAuthDiscoveryMetadata(runtime),
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

export const betterAuthSessionResolver =
  (auth: KevaAuth, db: PostgresJsDatabase<typeof authSchema>): SessionResolver =>
  async (headers) => {
    const result = await auth.api.getSession({ headers });
    if (!result) return null;

    const tenantId = await resolvePersonalOrganization(
      db,
      result.user.id,
      result.user.name?.trim() || result.user.email,
    );
    if (!tenantId) return null;
    // Only write the session when the active organization actually changes, so
    // a steady-state authenticated request performs no session write.
    const activeOrganizationId = (result as { session?: { activeOrganizationId?: string | null } })
      .session?.activeOrganizationId;
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
}

export interface ConnectionStore {
  readonly list: (userId: string) => Promise<ReadonlyArray<ConnectionSummary>>;
  readonly revoke: (userId: string, clientId: string) => Promise<boolean>;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export const makeConnectionStore = (
  db: PostgresJsDatabase<typeof authSchema>,
): ConnectionStore => ({
  list: async (userId) => {
    const rows = await db
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
      .where(eq(authSchema.oauthConsent.userId, userId))
      .orderBy(authSchema.oauthConsent.createdAt);
    return rows.map((row) => ({
      clientId: row.clientId,
      name: row.name ?? null,
      scopes: row.scopes ? row.scopes.split(" ").filter(Boolean) : [],
      createdAt: toIso(row.createdAt),
    }));
  },
  revoke: async (userId, clientId) => {
    await db
      .delete(authSchema.oauthAccessToken)
      .where(
        and(
          eq(authSchema.oauthAccessToken.userId, userId),
          eq(authSchema.oauthAccessToken.clientId, clientId),
        ),
      );
    const deleted = await db
      .delete(authSchema.oauthConsent)
      .where(
        and(
          eq(authSchema.oauthConsent.userId, userId),
          eq(authSchema.oauthConsent.clientId, clientId),
        ),
      )
      .returning({ clientId: authSchema.oauthConsent.clientId });
    return deleted.length > 0;
  },
});
