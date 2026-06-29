import {
  Forbidden,
  StorageUnavailable,
  Unauthorized,
  type MintToken,
  type MintTokenResult,
  type Principal,
  type Scope,
  type TokenRecord,
} from "@keva/schema";
import { Context, Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";

export interface AuthRequest {
  readonly headers: Headers;
}

export interface AuthenticatorService {
  readonly authenticate: (
    request: AuthRequest,
  ) => Effect.Effect<Principal, Unauthorized | StorageUnavailable>;
}

export class Authenticator extends Context.Tag("@keva/server/Authenticator")<
  Authenticator,
  AuthenticatorService
>() {}

type AuthStrategy = (
  request: AuthRequest,
) => Effect.Effect<Principal | null, StorageUnavailable>;

const secureEqual = (left: string, right: string): boolean => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index++) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
};

export const StaticTokenAuthLive = (config: {
  readonly token: string;
  readonly tenantId: string;
  readonly scopes?: ReadonlyArray<Scope>;
}): Layer.Layer<Authenticator> =>
  Layer.succeed(Authenticator, {
    authenticate: ({ headers }) => {
      const authorization = headers.get("authorization");
      const candidate = authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
      return secureEqual(candidate, config.token)
        ? Effect.succeed({
            tenantId: config.tenantId,
            scopes: [...(config.scopes ?? ["read", "write", "delete", "admin"])],
            via: "token" as const,
          })
        : Effect.fail(new Unauthorized({ message: "Invalid credential" }));
    },
  });

export const CompositeAuthLive = (
  strategies: ReadonlyArray<AuthStrategy>,
): Layer.Layer<Authenticator> =>
  Layer.succeed(Authenticator, {
    authenticate: (request) =>
      Effect.gen(function* () {
        for (const strategy of strategies) {
          const principal = yield* strategy(request);
          if (principal) return principal;
        }
        return yield* new Unauthorized({ message: "Invalid credential" });
      }),
  });

export const staticTokenStrategy = (config: {
  readonly token: string;
  readonly tenantId: string;
  readonly scopes?: ReadonlyArray<Scope>;
}): AuthStrategy =>
  ({ headers }) => {
    const authorization = headers.get("authorization");
    const candidate = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    return Effect.succeed(
      secureEqual(candidate, config.token)
        ? {
            tenantId: config.tenantId,
            scopes: [...(config.scopes ?? ["read", "write", "delete", "admin"])],
            via: "token" as const,
          }
        : null,
    );
  };

export interface ApiTokenStoreService {
  readonly resolve: (
    token: string,
  ) => Effect.Effect<Principal | null, StorageUnavailable>;
  readonly mint: (
    tenantId: string,
    input: MintToken,
  ) => Effect.Effect<MintTokenResult, StorageUnavailable>;
  readonly list: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<TokenRecord>, StorageUnavailable>;
  readonly revoke: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<boolean, StorageUnavailable>;
}

export class ApiTokenStore extends Context.Tag("@keva/server/ApiTokenStore")<
  ApiTokenStore,
  ApiTokenStoreService
>() {}

export const randomTokenPart = (bytes: number): string => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const TOKEN_PATTERN = /^keva_sk_([^_]+)_([^_]+)$/;

export const parseTokenParts = (
  token: string,
): { id: string; secret: string } | null => {
  const match = TOKEN_PATTERN.exec(token);
  return match ? { id: match[1]!, secret: match[2]! } : null;
};

const hashSecret = async (secret: string): Promise<string> => {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

interface TokenRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly secret_hash: string;
  readonly scopes: ReadonlyArray<Scope>;
  readonly created_at: Date | string;
  readonly expires_at: Date | string | null;
  readonly last_used_at: Date | string | null;
}

const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();

const tokenRecord = (row: TokenRow): TokenRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  scopes: [...row.scopes],
  createdAt: iso(row.created_at)!,
  expiresAt: iso(row.expires_at),
  lastUsedAt: iso(row.last_used_at),
});

// A failed token-store query is infrastructure unavailability, not a bad
// credential: surface StorageUnavailable (-> 502) instead of swallowing it
// into a 401 (resolve) or an opaque 500 (mint/list/revoke).
const storageError = (): StorageUnavailable =>
  new StorageUnavailable({ message: "Token storage unavailable" });

export const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export const shouldRefreshLastUsed = (
  lastUsedAt: Date | string | null,
  now: Date,
): boolean =>
  lastUsedAt === null ||
  now.getTime() - new Date(lastUsedAt).getTime() >= LAST_USED_UPDATE_INTERVAL_MS;

export const makePostgresApiTokenStore = (sql: Sql): ApiTokenStoreService => ({
  resolve: (token) =>
    Effect.tryPromise({
      try: async () => {
        const parsed = parseTokenParts(token);
        if (!parsed) return null;
        const rows = await sql<TokenRow[]>`
          select * from api_tokens where id = ${parsed.id} limit 1
        `;
        const row = rows[0];
        if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) {
          return null;
        }
        const candidate = await hashSecret(parsed.secret);
        if (!secureEqual(candidate, row.secret_hash)) return null;
        await sql`
          update api_tokens
          set last_used_at = now()
          where id = ${row.id}
            and (
              last_used_at is null or
              last_used_at < now() - interval '5 minutes'
            )
        `;
        return {
          tenantId: row.tenant_id,
          scopes: [...row.scopes],
          via: "token" as const,
        };
      },
      catch: storageError,
    }),
  mint: (tenantId, input) =>
    Effect.tryPromise({
      try: async () => {
        const id = randomTokenPart(9);
        const secret = randomTokenPart(32);
        const plaintext = `keva_sk_${id}_${secret}`;
        const secretHash = await hashSecret(secret);
        const rows = await sql<TokenRow[]>`
          insert into api_tokens (
            id, tenant_id, name, secret_hash, scopes, created_at, expires_at
          ) values (
            ${id}, ${tenantId}, ${input.name}, ${secretHash},
            ${sql.json(input.scopes)}, now(), ${input.expiresAt ?? null}
          )
          returning *
        `;
        return { token: plaintext, record: tokenRecord(rows[0]!) };
      },
      catch: storageError,
    }),
  list: (tenantId) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<TokenRow[]>`
          select * from api_tokens
          where tenant_id = ${tenantId}
          order by created_at desc
        `;
        return rows.map(tokenRecord);
      },
      catch: storageError,
    }),
  revoke: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from api_tokens
          where tenant_id = ${tenantId} and id = ${id}
          returning id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
});

export const PostgresApiTokenStoreLive = (
  url: string,
): Layer.Layer<ApiTokenStore> =>
  Layer.scoped(
    ApiTokenStore,
    Effect.acquireRelease(
      Effect.sync(() => postgres(url)),
      (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
    ).pipe(Effect.map(makePostgresApiTokenStore)),
  );

export const tokenStrategy = (
  store: ApiTokenStoreService,
): AuthStrategy =>
  ({ headers }) => {
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith("Bearer keva_sk_")) {
      return Effect.succeed(null);
    }
    return store.resolve(authorization.slice(7));
  };

export const TokenAndStaticAuthLive = (config: {
  readonly store: ApiTokenStoreService;
  readonly staticToken: string;
  readonly tenantId: string;
  readonly sessionResolver?: SessionResolver;
}): Layer.Layer<Authenticator> =>
  CompositeAuthLive([
    tokenStrategy(config.store),
    ...(config.sessionResolver ? [sessionStrategy(config.sessionResolver)] : []),
    staticTokenStrategy({
      token: config.staticToken,
      tenantId: config.tenantId,
    }),
  ]);

export const TokenAndStaticAuthFromStoreLive = (config: {
  readonly staticToken: string;
  readonly tenantId: string;
  readonly sessionResolver?: SessionResolver;
}): Layer.Layer<Authenticator, never, ApiTokenStore> =>
  Layer.effect(
    Authenticator,
    Effect.gen(function* () {
      const store = yield* ApiTokenStore;
      const strategies = [
        tokenStrategy(store),
        ...(config.sessionResolver
          ? [sessionStrategy(config.sessionResolver)]
          : []),
        staticTokenStrategy({
          token: config.staticToken,
          tenantId: config.tenantId,
        }),
      ];
      return {
        authenticate: (request: AuthRequest) =>
          Effect.gen(function* () {
            for (const strategy of strategies) {
              const principal = yield* strategy(request);
              if (principal) return principal;
            }
            return yield* new Unauthorized({ message: "Invalid credential" });
          }),
      };
    }),
  );

export type SessionResolver = (
  headers: Headers,
) => Promise<{
  readonly tenantId: string;
  readonly scopes?: ReadonlyArray<Scope>;
} | null>;

export const sessionStrategy = (
  resolve: SessionResolver,
): AuthStrategy =>
  ({ headers }) => {
    if (!headers.get("cookie")) return Effect.succeed(null);
    return Effect.tryPromise({
      try: () => resolve(headers),
      catch: () =>
        new StorageUnavailable({ message: "Session storage unavailable" }),
    }).pipe(
      Effect.map((session) =>
        session
          ? {
              tenantId: session.tenantId,
              scopes: [...(session.scopes ?? ["read", "write", "delete", "admin"])],
              via: "session" as const,
            }
          : null
      ),
    );
  };

export const requireAdminSession = (
  principal: Principal,
): Effect.Effect<void, Forbidden> =>
  principal.via === "session" && principal.scopes.includes("admin")
    ? Effect.void
    : Effect.fail(
        new Forbidden({ message: "Token management requires an admin session" }),
      );
