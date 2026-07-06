import {
  StorageUnavailable,
  type CreateShareGrant,
  type CreateShareGrantResult,
  type Principal,
  type Properties,
  type QueryCondition,
  type ShareGrantRecord,
  type ShareScope,
} from "@keva/schema";
import { Context, Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";
import { type AuthStrategy, hashSecret, randomTokenPart, secureEqual } from "./auth.js";

// Share tokens mirror API tokens (`keva_sk_…`): a public id and a secret,
// single-underscore separated over a delimiter-free hex alphabet so the split
// is unambiguous. Only the secret's SHA-256 hash is stored.
const SHARE_TOKEN_PATTERN = /^keva_sh_([^_]+)_([^_]+)$/;

export const parseShareTokenParts = (token: string): { id: string; secret: string } | null => {
  const match = SHARE_TOKEN_PATTERN.exec(token);
  return match ? { id: match[1]!, secret: match[2]! } : null;
};

export interface ShareGrantStoreService {
  readonly resolve: (token: string) => Effect.Effect<Principal | null, StorageUnavailable>;
  readonly create: (
    tenantId: string,
    input: CreateShareGrant,
  ) => Effect.Effect<CreateShareGrantResult, StorageUnavailable>;
  readonly list: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<ShareGrantRecord>, StorageUnavailable>;
  readonly get: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<ShareGrantRecord | null, StorageUnavailable>;
  readonly revoke: (tenantId: string, id: string) => Effect.Effect<boolean, StorageUnavailable>;
}

export class ShareGrantStore extends Context.Tag("@keva/server/ShareGrantStore")<
  ShareGrantStore,
  ShareGrantStoreService
>() {}

// `view_conditions` is joined in from the referenced view (share_grants no
// longer stores its own conditions) — read live, so the record and the resolved
// principal always reflect the current view filter.
interface ShareRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly view_id: string;
  readonly name: string;
  readonly secret_hash: string;
  readonly scopes: ReadonlyArray<ShareScope>;
  readonly view_conditions: ReadonlyArray<QueryCondition>;
  readonly write_stamp: Properties | null;
  // bigint columns arrive as strings from postgres.js; integer as a number.
  readonly max_item_bytes: number | string | null;
  readonly max_total_bytes: number | string | null;
  readonly max_items: number | string | null;
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

const numOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

const shareRecord = (row: ShareRow): ShareGrantRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  viewId: row.view_id,
  name: row.name,
  scopes: [...row.scopes],
  conditions: [...row.view_conditions],
  writeStamp: row.write_stamp ?? null,
  maxItemBytes: numOrNull(row.max_item_bytes),
  maxTotalBytes: numOrNull(row.max_total_bytes),
  maxItems: numOrNull(row.max_items),
  createdAt: iso(row.created_at)!,
  expiresAt: iso(row.expires_at),
  lastUsedAt: iso(row.last_used_at),
});

// The resolved principal carries the grant's conditions, write stamp, and quota
// limits, so the engine enforces access without ever re-reading the grant row.
const shareGrantPrincipal = (row: ShareRow): Principal => ({
  tenantId: row.tenant_id,
  scopes: [...row.scopes],
  via: "share",
  share: {
    grantId: row.id,
    conditions: [...row.view_conditions],
    ...(row.write_stamp ? { writeStamp: row.write_stamp } : {}),
    limits: {
      maxItemBytes: numOrNull(row.max_item_bytes),
      maxTotalBytes: numOrNull(row.max_total_bytes),
      maxItems: numOrNull(row.max_items),
    },
  },
});

// A failed share-store query is infrastructure unavailability, not a bad token:
// surface StorageUnavailable (-> 502) rather than a silent 401/500.
const storageError = (): StorageUnavailable =>
  new StorageUnavailable({ message: "Share grant storage unavailable" });

export const makePostgresShareGrantStore = (sql: Sql): ShareGrantStoreService => ({
  resolve: (token) =>
    Effect.tryPromise({
      try: async () => {
        const parsed = parseShareTokenParts(token);
        if (!parsed) return null;
        const rows = await sql<ShareRow[]>`
          select g.*, v.conditions as view_conditions
          from share_grants g
          join views v on v.id = g.view_id
          where g.id = ${parsed.id}
          limit 1
        `;
        const row = rows[0];
        if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) {
          return null;
        }
        const candidate = await hashSecret(parsed.secret);
        if (!secureEqual(candidate, row.secret_hash)) return null;
        await sql`
          update share_grants
          set last_used_at = now()
          where id = ${row.id}
            and (last_used_at is null or last_used_at < now() - interval '5 minutes')
        `;
        return shareGrantPrincipal(row);
      },
      catch: storageError,
    }),
  create: (tenantId, input) =>
    Effect.tryPromise({
      try: async () => {
        const id = randomTokenPart(9);
        const secret = randomTokenPart(32);
        const plaintext = `keva_sh_${id}_${secret}`;
        const secretHash = await hashSecret(secret);
        // Insert then join the referenced view back in, so the returned record
        // carries the live view conditions in one round trip. The view_id FK
        // guarantees the view exists (the route also pre-checks tenant ownership).
        const rows = await sql<ShareRow[]>`
          with g as (
            insert into share_grants (
              id, tenant_id, view_id, name, secret_hash, scopes, write_stamp,
              max_item_bytes, max_total_bytes, max_items, created_at, expires_at
            ) values (
              ${id}, ${tenantId}, ${input.viewId}, ${input.name}, ${secretHash},
              ${sql.json(input.scopes)},
              ${input.writeStamp ? sql.json(input.writeStamp) : null},
              ${input.maxItemBytes ?? null}, ${input.maxTotalBytes ?? null},
              ${input.maxItems ?? null}, now(), ${input.expiresAt ?? null}
            )
            returning *
          )
          select g.*, v.conditions as view_conditions
          from g join views v on v.id = g.view_id
        `;
        return { token: plaintext, record: shareRecord(rows[0]!) };
      },
      catch: storageError,
    }),
  list: (tenantId) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<ShareRow[]>`
          select g.*, v.conditions as view_conditions
          from share_grants g
          join views v on v.id = g.view_id
          where g.tenant_id = ${tenantId}
          order by g.created_at desc
        `;
        return rows.map(shareRecord);
      },
      catch: storageError,
    }),
  get: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<ShareRow[]>`
          select g.*, v.conditions as view_conditions
          from share_grants g
          join views v on v.id = g.view_id
          where g.tenant_id = ${tenantId} and g.id = ${id}
          limit 1
        `;
        return rows[0] ? shareRecord(rows[0]) : null;
      },
      catch: storageError,
    }),
  revoke: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from share_grants
          where tenant_id = ${tenantId} and id = ${id}
          returning id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
});

export const PostgresShareGrantStoreLive = (url: string): Layer.Layer<ShareGrantStore> =>
  Layer.scoped(
    ShareGrantStore,
    Effect.acquireRelease(
      Effect.sync(() => postgres(url)),
      (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
    ).pipe(Effect.map(makePostgresShareGrantStore)),
  );

export const shareStrategy =
  (store: ShareGrantStoreService): AuthStrategy =>
  ({ headers }) => {
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith("Bearer keva_sh_")) {
      return Effect.succeed(null);
    }
    return store.resolve(authorization.slice(7));
  };
