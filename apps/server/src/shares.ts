import {
  Conflict,
  NotFound,
  StorageUnavailable,
  ValidationError,
  isPropertyKey,
  propertiesMatchCondition,
  type CreateShareGrant,
  type CreateShareGrantResult,
  type Principal,
  type Properties,
  type QueryCondition,
  type ShareGrantRecord,
  type ShareScope,
  type UpdateView,
  type ViewRecord,
} from "@keva/schema";
import { Context, Effect } from "effect";
import { type Sql } from "postgres";
import { jsonbParam } from "./postgres-json.js";
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
  ) => Effect.Effect<CreateShareGrantResult, StorageUnavailable | NotFound | ValidationError>;
  readonly list: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<ShareGrantRecord>, StorageUnavailable>;
  readonly get: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<ShareGrantRecord | null, StorageUnavailable>;
  readonly revoke: (tenantId: string, id: string) => Effect.Effect<boolean, StorageUnavailable>;
  readonly updateView: (
    tenantId: string,
    id: string,
    input: UpdateView,
  ) => Effect.Effect<ViewRecord | null, StorageUnavailable | Conflict>;
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
  readonly token: string | null;
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

interface ViewRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly conditions: ReadonlyArray<QueryCondition>;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
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
  token: row.token ?? null,
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

const viewRecord = (row: ViewRow): ViewRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  icon: row.icon,
  conditions: [...row.conditions],
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

const shareGrantPrincipal = (row: ShareRow): Principal => ({
  tenantId: row.tenant_id,
  scopes: [...row.scopes],
  via: "share",
  actor: { share: { grantId: row.id, name: row.name } },
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

// postgres.js serializes a `.json()` value using the parameter type it resolves
// for the placeholder. A plain `insert ... values` yields jsonb and an array
// serializes fine, but inside a CTE insert or a coalesce() the type resolves to
// unknown, postgres.js then infers a Postgres array from the JS value, and a
// top-level array (scopes, conditions) throws at Bind. Pre-stringify and cast so
// the wire value is always text -> jsonb.
const writeGrantValidation = (
  input: CreateShareGrant,
  conditions: readonly QueryCondition[],
): ValidationError | null => {
  if (!input.scopes.includes("write")) return null;
  if (!conditions.every((condition) => isPropertyKey(condition.key))) {
    return new ValidationError({
      message: "Write grants may only condition on plain property keys",
    });
  }
  if (!conditions.every((condition) => propertiesMatchCondition(input.writeStamp!, condition))) {
    return new ValidationError({ message: "writeStamp must satisfy every view condition" });
  }
  return null;
};

const incompatibleWriteGrant = (
  writeStamp: Properties | null,
  conditions: readonly QueryCondition[],
): boolean =>
  !conditions.every((condition) => isPropertyKey(condition.key)) ||
  !conditions.every((condition) => propertiesMatchCondition(writeStamp ?? {}, condition));

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
    Effect.gen(function* () {
      if (input.view) {
        const validation = writeGrantValidation(input, input.view.conditions);
        if (validation) return yield* validation;
      }
      const result = yield* Effect.tryPromise({
        try: async () => {
          return sql.begin(async (transaction) => {
            let view: ViewRow | undefined;
            if (input.view) {
              const viewId = randomTokenPart(12);
              const rows = await transaction<ViewRow[]>`
                insert into views (id, tenant_id, name, icon, conditions, created_at, updated_at)
                values (${viewId}, ${tenantId}, ${input.view.name}, ${input.view.icon ?? null}, ${jsonbParam(input.view.conditions)}::jsonb, now(), now())
                returning *
              `;
              view = rows[0];
            } else {
              const rows = await transaction<ViewRow[]>`
                select * from views
                where tenant_id = ${tenantId} and id = ${input.viewId!}
                for update
              `;
              view = rows[0];
            }
            if (!view) return { status: "missing" as const };
            const validation = input.view ? null : writeGrantValidation(input, view.conditions);
            if (validation) return { status: "invalid" as const, message: validation.message };
            const id = randomTokenPart(9);
            const secret = randomTokenPart(32);
            const plaintext = `keva_sh_${id}_${secret}`;
            const secretHash = await hashSecret(secret);
            const rows = await transaction<ShareRow[]>`
          with g as (
            insert into share_grants (
              id, tenant_id, view_id, name, secret_hash, token, scopes, write_stamp,
              max_item_bytes, max_total_bytes, max_items, created_at, expires_at
            ) values (
              ${id}, ${tenantId}, ${view.id}, ${input.name}, ${secretHash}, ${plaintext},
              ${jsonbParam(input.scopes)}::jsonb,
              ${jsonbParam(input.writeStamp)}::jsonb,
              ${input.maxItemBytes ?? null}, ${input.maxTotalBytes ?? null},
              ${input.maxItems ?? null}, now(), ${input.expiresAt ?? null}
            )
            returning *
          )
          select g.*, v.conditions as view_conditions
            from g join views v on v.id = g.view_id
        `;
            return {
              status: "created" as const,
              result: { token: plaintext, record: shareRecord(rows[0]!), view: viewRecord(view) },
            };
          });
        },
        catch: storageError,
      });
      if (result.status === "missing") return yield* new NotFound({ message: "View not found" });
      if (result.status === "invalid")
        return yield* new ValidationError({ message: result.message });
      return result.result;
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
  updateView: (tenantId, id, input) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          sql.begin(async (transaction) => {
            const views = await transaction<ViewRow[]>`
              select * from views where tenant_id = ${tenantId} and id = ${id} for update
            `;
            const view = views[0];
            if (!view) return { status: "missing" as const };
            const conditions = input.conditions ?? view.conditions;
            const grants = await transaction<{ id: string; write_stamp: Properties | null }[]>`
              select id, write_stamp from share_grants
              where tenant_id = ${tenantId} and view_id = ${id}
                and scopes @> '["write"]'::jsonb
                and (expires_at is null or expires_at > now())
              for update
            `;
            const grantIds = grants
              .filter((grant) => incompatibleWriteGrant(grant.write_stamp, conditions))
              .map((grant) => grant.id);
            if (grantIds.length > 0) return { status: "incompatible" as const, grantIds };
            const updated = await transaction<ViewRow[]>`
              update views set
                name = coalesce(${input.name ?? null}::text, name),
                icon = coalesce(${input.icon ?? null}::text, icon),
                conditions = coalesce(${jsonbParam(input.conditions)}::jsonb, conditions),
                updated_at = now()
              where tenant_id = ${tenantId} and id = ${id}
              returning *
            `;
            return { status: "updated" as const, view: viewRecord(updated[0]!) };
          }),
        catch: storageError,
      });
      if (result.status === "incompatible") {
        return yield* new Conflict({
          message: "Revoke the affected upload links before changing this view's conditions",
          grantIds: result.grantIds,
        });
      }
      return result.status === "updated" ? result.view : null;
    }),
});

export const shareStrategy =
  (store: ShareGrantStoreService): AuthStrategy =>
  ({ headers }) => {
    const authorization = headers.get("authorization");
    if (!authorization?.startsWith("Bearer keva_sh_")) {
      return Effect.succeed(null);
    }
    return store.resolve(authorization.slice(7));
  };
