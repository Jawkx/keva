import {
  type AccountShareRecord,
  Conflict,
  type CreateAccountShare,
  NotFound,
  type ReceivedShare,
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
  readonly createAccount: (
    tenantId: string,
    ownerUserId: string,
    input: CreateAccountShare,
  ) => Effect.Effect<
    AccountShareRecord,
    StorageUnavailable | NotFound | ValidationError | Conflict
  >;
  readonly listAccountOwned: (
    tenantId: string,
  ) => Effect.Effect<ReadonlyArray<AccountShareRecord>, StorageUnavailable>;
  readonly listReceived: (
    recipientUserId: string,
  ) => Effect.Effect<ReadonlyArray<ReceivedShare>, StorageUnavailable>;
  readonly acceptAccount: (
    recipientUserId: string,
    id: string,
  ) => Effect.Effect<ReceivedShare | null, StorageUnavailable>;
  readonly declineAccount: (
    recipientUserId: string,
    id: string,
  ) => Effect.Effect<boolean, StorageUnavailable>;
  readonly leaveAccount: (
    recipientUserId: string,
    id: string,
  ) => Effect.Effect<boolean, StorageUnavailable>;
  readonly revokeAccount: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<boolean, StorageUnavailable>;
  readonly accessAccount: (
    recipient: { readonly id: string; readonly name: string },
    id: string,
  ) => Effect.Effect<AccountShareAccess | null, StorageUnavailable>;
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
  readonly kind: "link" | "account";
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

interface AccountShareRow extends ShareRow {
  readonly account_status: "pending" | "accepted";
  readonly account_created_at: Date | string;
  readonly accepted_at: Date | string | null;
  readonly recipient_id: string;
  readonly recipient_name: string;
  readonly recipient_email: string;
  readonly owner_id: string;
  readonly owner_name: string;
  readonly owner_email: string;
  readonly view_name: string;
  readonly view_icon: string | null;
}

export interface AccountShareAccess {
  readonly principal: Principal;
  readonly received: ReceivedShare;
  readonly grant: AccountShareRecord;
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

const accountRecord = (row: AccountShareRow): AccountShareRecord => ({
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
  status: row.account_status,
  recipient: {
    id: row.recipient_id,
    name: row.recipient_name,
    email: row.recipient_email,
  },
  createdAt: iso(row.account_created_at)!,
  acceptedAt: iso(row.accepted_at),
  expiresAt: iso(row.expires_at),
});

const receivedRecord = (row: AccountShareRow): ReceivedShare => ({
  id: row.id,
  name: row.view_name,
  icon: row.view_icon,
  scopes: [...row.scopes],
  status: row.account_status,
  owner: { id: row.owner_id, name: row.owner_name, email: row.owner_email },
  createdAt: iso(row.account_created_at)!,
  acceptedAt: iso(row.accepted_at),
  expiresAt: iso(row.expires_at),
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

const shareGrantPrincipal = (
  row: ShareRow,
  user?: { readonly id: string; readonly name: string },
): Principal => ({
  tenantId: row.tenant_id,
  scopes: [...row.scopes],
  via: "share",
  actor: {
    ...(user ? { user } : {}),
    share: { grantId: row.id, name: row.name },
  },
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
            and g.kind = 'link'
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
            and g.kind = 'link'
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
            and g.kind = 'link'
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
          where tenant_id = ${tenantId} and id = ${id} and kind = 'link'
          returning id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
  createAccount: (tenantId, ownerUserId, input) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () =>
          sql.begin(async (transaction) => {
            const recipients = await transaction<{ id: string; name: string; email: string }[]>`
              select id, name, email from "user"
              where lower(email) = lower(${input.recipientEmail.trim()})
              limit 1
            `;
            const recipient = recipients[0];
            if (!recipient) return { status: "recipient_missing" as const };
            if (recipient.id === ownerUserId) return { status: "self" as const };

            const views = await transaction<ViewRow[]>`
              select * from views
              where tenant_id = ${tenantId} and id = ${input.viewId}
              for update
            `;
            const view = views[0];
            if (!view) return { status: "view_missing" as const };
            const validation = writeGrantValidation({ ...input, name: view.name }, view.conditions);
            if (validation) return { status: "invalid" as const, message: validation.message };

            const duplicate = await transaction`
              select 1
              from account_share_grants a
              join share_grants g on g.id = a.grant_id
              where g.tenant_id = ${tenantId}
                and g.view_id = ${view.id}
                and a.recipient_user_id = ${recipient.id}
                and (g.expires_at is null or g.expires_at > now())
              limit 1
            `;
            if (duplicate.length > 0) return { status: "duplicate" as const };

            const owners = await transaction<{ id: string; name: string; email: string }[]>`
              select id, name, email from "user" where id = ${ownerUserId} limit 1
            `;
            const owner = owners[0];
            if (!owner) return { status: "owner_missing" as const };

            const id = randomTokenPart(9);
            const unreachableSecretHash = await hashSecret(randomTokenPart(32));
            const grants = await transaction<ShareRow[]>`
              insert into share_grants (
                id, tenant_id, view_id, kind, name, secret_hash, token, scopes, write_stamp,
                max_item_bytes, max_total_bytes, max_items, created_at, expires_at
              ) values (
                ${id}, ${tenantId}, ${view.id}, 'account', ${view.name}, ${unreachableSecretHash}, null,
                ${jsonbParam(input.scopes)}::jsonb,
                ${jsonbParam(input.writeStamp)}::jsonb,
                ${input.maxItemBytes ?? null}, ${input.maxTotalBytes ?? null},
                ${input.maxItems ?? null}, now(), ${input.expiresAt ?? null}
              )
              returning *, ${jsonbParam(view.conditions)}::jsonb as view_conditions
            `;
            const accounts = await transaction<
              { created_at: Date | string; status: "pending" | "accepted" }[]
            >`
              insert into account_share_grants (
                grant_id, owner_user_id, recipient_user_id, invited_email, status, created_at
              ) values (
                ${id}, ${owner.id}, ${recipient.id}, ${recipient.email}, 'pending', now()
              )
              returning created_at, status
            `;
            const row: AccountShareRow = {
              ...grants[0]!,
              account_status: accounts[0]!.status,
              account_created_at: accounts[0]!.created_at,
              accepted_at: null,
              recipient_id: recipient.id,
              recipient_name: recipient.name,
              recipient_email: recipient.email,
              owner_id: owner.id,
              owner_name: owner.name,
              owner_email: owner.email,
              view_name: view.name,
              view_icon: view.icon,
            };
            return { status: "created" as const, record: accountRecord(row) };
          }),
        catch: storageError,
      });
      if (result.status === "recipient_missing") {
        return yield* new NotFound({ message: "No Keva account exists for that email" });
      }
      if (result.status === "view_missing") {
        return yield* new NotFound({ message: "View not found" });
      }
      if (result.status === "owner_missing") {
        return yield* new NotFound({ message: "Owner account not found" });
      }
      if (result.status === "self") {
        return yield* new ValidationError({ message: "You already own this view" });
      }
      if (result.status === "invalid") {
        return yield* new ValidationError({ message: result.message });
      }
      if (result.status === "duplicate") {
        return yield* new Conflict({ message: "This view is already shared with that account" });
      }
      return result.record;
    }),
  listAccountOwned: (tenantId) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<AccountShareRow[]>`
          select g.*, v.conditions as view_conditions, v.name as view_name, v.icon as view_icon,
            a.status as account_status, a.created_at as account_created_at, a.accepted_at,
            recipient.id as recipient_id, recipient.name as recipient_name,
            recipient.email as recipient_email,
            owner_user.id as owner_id, owner_user.name as owner_name,
            owner_user.email as owner_email
          from account_share_grants a
          join share_grants g on g.id = a.grant_id
          join views v on v.id = g.view_id
          join "user" recipient on recipient.id = a.recipient_user_id
          join "user" owner_user on owner_user.id = a.owner_user_id
          where g.tenant_id = ${tenantId}
            and g.kind = 'account'
          order by a.created_at desc
        `;
        return rows.map(accountRecord);
      },
      catch: storageError,
    }),
  listReceived: (recipientUserId) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<AccountShareRow[]>`
          select g.*, v.conditions as view_conditions, v.name as view_name, v.icon as view_icon,
            a.status as account_status, a.created_at as account_created_at, a.accepted_at,
            recipient.id as recipient_id, recipient.name as recipient_name,
            recipient.email as recipient_email,
            owner_user.id as owner_id, owner_user.name as owner_name,
            owner_user.email as owner_email
          from account_share_grants a
          join share_grants g on g.id = a.grant_id
          join views v on v.id = g.view_id
          join "user" recipient on recipient.id = a.recipient_user_id
          join "user" owner_user on owner_user.id = a.owner_user_id
          where a.recipient_user_id = ${recipientUserId}
            and g.kind = 'account'
            and (g.expires_at is null or g.expires_at > now())
          order by a.created_at desc
        `;
        return rows.map(receivedRecord);
      },
      catch: storageError,
    }),
  acceptAccount: (recipientUserId, id) =>
    Effect.tryPromise({
      try: () =>
        sql.begin(async (transaction) => {
          const current = await transaction`
            select a.grant_id
            from account_share_grants a
            join share_grants g on g.id = a.grant_id
            where a.grant_id = ${id}
              and a.recipient_user_id = ${recipientUserId}
              and g.kind = 'account'
              and (g.expires_at is null or g.expires_at > now())
            for update
          `;
          if (current.length === 0) return null;
          await transaction`
            update account_share_grants
            set status = 'accepted', accepted_at = coalesce(accepted_at, now())
            where grant_id = ${id}
          `;
          const rows = await transaction<AccountShareRow[]>`
            select g.*, v.conditions as view_conditions, v.name as view_name, v.icon as view_icon,
              a.status as account_status, a.created_at as account_created_at, a.accepted_at,
              recipient.id as recipient_id, recipient.name as recipient_name,
              recipient.email as recipient_email,
              owner_user.id as owner_id, owner_user.name as owner_name,
              owner_user.email as owner_email
            from account_share_grants a
            join share_grants g on g.id = a.grant_id
            join views v on v.id = g.view_id
            join "user" recipient on recipient.id = a.recipient_user_id
            join "user" owner_user on owner_user.id = a.owner_user_id
            where a.grant_id = ${id} and g.kind = 'account'
          `;
          return rows[0] ? receivedRecord(rows[0]) : null;
        }),
      catch: storageError,
    }),
  declineAccount: (recipientUserId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from share_grants g
          using account_share_grants a
          where g.id = a.grant_id
            and g.id = ${id}
            and a.recipient_user_id = ${recipientUserId}
            and a.status = 'pending'
            and g.kind = 'account'
          returning g.id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
  leaveAccount: (recipientUserId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from share_grants g
          using account_share_grants a
          where g.id = a.grant_id
            and g.id = ${id}
            and a.recipient_user_id = ${recipientUserId}
            and g.kind = 'account'
          returning g.id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
  revokeAccount: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from share_grants g
          using account_share_grants a
          where g.id = a.grant_id and g.id = ${id} and g.tenant_id = ${tenantId}
            and g.kind = 'account'
          returning g.id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
  accessAccount: (recipient, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<AccountShareRow[]>`
          select g.*, v.conditions as view_conditions, v.name as view_name, v.icon as view_icon,
            a.status as account_status, a.created_at as account_created_at, a.accepted_at,
            recipient_user.id as recipient_id, recipient_user.name as recipient_name,
            recipient_user.email as recipient_email,
            owner_user.id as owner_id, owner_user.name as owner_name,
            owner_user.email as owner_email
          from account_share_grants a
          join share_grants g on g.id = a.grant_id
          join views v on v.id = g.view_id
          join "user" recipient_user on recipient_user.id = a.recipient_user_id
          join "user" owner_user on owner_user.id = a.owner_user_id
          where a.grant_id = ${id}
            and a.recipient_user_id = ${recipient.id}
            and a.status = 'accepted'
            and g.kind = 'account'
            and (g.expires_at is null or g.expires_at > now())
          limit 1
        `;
        const row = rows[0];
        return row
          ? {
              principal: shareGrantPrincipal(row, recipient),
              received: receivedRecord(row),
              grant: accountRecord(row),
            }
          : null;
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
                and (
                  kind = 'link' or exists (
                    select 1 from account_share_grants a where a.grant_id = share_grants.id
                  )
                )
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
