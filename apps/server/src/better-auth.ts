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
        handler(request, { userId: session.userId, scopes: session.scopes }),
      ),
    sessionApi: betterAuthSessionApi(auth),
  };
};

// The first authenticated request provisions a user's personal organization.
export const betterAuthSessionResolver =
  (auth: KevaAuth): SessionResolver =>
  async (headers) => {
    const result = await auth.api.getSession({ headers });
    if (!result) return null;

    const api = organizationApi(auth);
    let tenantId =
      (
        result.session as typeof result.session & {
          readonly activeOrganizationId?: string | null;
        }
      ).activeOrganizationId ?? null;

    if (!tenantId) {
      const existing = await api.listOrganizations({ headers });
      if (existing.length > 0) {
        tenantId = existing[0]!.id;
        await api.setActiveOrganization({
          headers,
          body: { organizationId: tenantId },
        });
      } else {
        const label = result.user.name?.trim() || result.user.email;
        const created = await api
          .createOrganization({
            headers,
            body: { name: `${label}'s space`, slug: `keva-${result.user.id}` },
          })
          // A concurrent first request may have already created it; fall back
          // to whatever now exists rather than failing the whole request.
          .catch(() => null);
        tenantId = created?.id ?? (await api.listOrganizations({ headers }))[0]?.id ?? null;
      }
    }
    if (!tenantId) return null;

    // A signed-in user currently controls their personal tenant fully.
    return { tenantId, scopes: ["read", "write", "delete", "admin"] };
  };

// MCP tokens carry user identity, not active-organization session state.
export const makeUserTenantResolver =
  (db: PostgresJsDatabase<typeof authSchema>) =>
  async (userId: string): Promise<string | null> => {
    const rows = await db
      .select({ organizationId: authSchema.member.organizationId })
      .from(authSchema.member)
      .where(eq(authSchema.member.userId, userId))
      .orderBy(authSchema.member.createdAt)
      .limit(1);
    return rows[0]?.organizationId ?? null;
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
