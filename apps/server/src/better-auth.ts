import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization } from "better-auth/plugins";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SessionResolver } from "./auth.js";
import * as authSchema from "./auth-schema.js";

export interface BetterAuthConfig {
  readonly database: PostgresJsDatabase<any>;
  readonly secret: string;
  readonly baseURL: string;
  readonly trustedOrigins?: ReadonlyArray<string>;
}

export const createBetterAuth = (config: BetterAuthConfig): ReturnType<typeof betterAuth> =>
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
    plugins: [organization()],
  }) as unknown as ReturnType<typeof betterAuth>;

// keva's tenant boundary is a Better Auth organization. A brand-new user has
// no organization yet, so the first authenticated request provisions a personal
// one. Better Auth's `createOrganization` makes the new org the session's active
// org automatically (creator joins as "owner"), so after the first call every
// subsequent session short-circuits on `activeOrganizationId`.
export const betterAuthSessionResolver =
  (auth: ReturnType<typeof createBetterAuth>): SessionResolver =>
  async (headers) => {
    const result = await auth.api.getSession({ headers });
    if (!result) return null;

    const api = auth.api as unknown as {
      listOrganizations: (input: { headers: Headers }) => Promise<ReadonlyArray<{ id: string }>>;
      createOrganization: (input: {
        headers: Headers;
        body: { name: string; slug: string };
      }) => Promise<{ id: string } | null>;
      setActiveOrganization: (input: {
        headers: Headers;
        body: { organizationId: string };
      }) => Promise<unknown>;
    };

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

    // In keva's consumer model each user owns their personal organization, so a
    // logged-in human controls their own tenant fully — including the
    // session-only admin action of minting API tokens. Finer per-member scope
    // mapping for shared/multi-member orgs is deferred to multi-tenant hardening.
    return { tenantId, scopes: ["read", "write", "delete", "admin"] };
  };
