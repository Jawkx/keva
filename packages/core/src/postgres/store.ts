import {
  FIELD_BY_KEY,
  canonicalizeProperties,
  decodeCursor as decodeSharedCursor,
  encodeCursor,
  Internal,
  Conflict,
  QuotaExceeded,
  SubscriptionRequired,
  validateProperties,
  ValidationError,
  type Actor,
  type ItemEvent,
  type ItemEventPayload,
  type KevaError,
  type KevaItem,
  type PropertyKind,
  type PropertyScalar,
  type QueryCondition,
  type QueryOrder,
  type Cursor,
} from "@keva/schema";
import { Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";
import {
  MetadataStore,
  type MetadataStoreService,
  type UploadAttempt,
  DEFAULT_STORAGE_QUOTA_BYTES,
  SUGGESTION_KEY_LIMIT,
  SUGGESTION_VALUE_LIMIT,
} from "../services.js";

export interface PostgresConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
}

interface ItemRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly content_type: string;
  readonly declared_size: number | string;
  readonly size: number | string | null;
  readonly etag: string | null;
  readonly source: string;
  readonly status: "pending" | "confirming" | "ready" | "deleting";
  readonly storage_key: string;
  readonly staging_key: string;
  readonly revision: number;
  readonly upload_period_start: Date | string | null;
  readonly upload_reservation_state: "reserved" | "consumed" | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly properties: KevaItem["properties"];
}

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRow = (row: ItemRow): KevaItem => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  contentType: row.content_type,
  declaredSize: Number(row.declared_size),
  size: row.size === null ? null : Number(row.size),
  etag: row.etag,
  source: row.source,
  status: row.status,
  storageKey: row.storage_key,
  stagingKey: row.staging_key,
  revision: row.revision,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
  properties: canonicalizeProperties(row.properties),
});

interface UploadAttemptRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly item_id: string | null;
  readonly retry_key: string | null;
  readonly request_hash: string | null;
  readonly staging_key: string;
  readonly storage_key: string;
  readonly upload_url: string;
  readonly upload_headers: Readonly<Record<string, string>>;
  readonly expected_size: number | string;
  readonly expires_at: Date | string;
  readonly state: UploadAttempt["state"];
  readonly observed_etag: string | null;
  readonly cleanup_after: Date | string;
  readonly next_retry_at: Date | string;
  readonly retry_count: number;
}

const mapAttemptRow = (row: UploadAttemptRow): UploadAttempt => ({
  id: row.id,
  tenantId: row.tenant_id,
  itemId: row.item_id,
  retryKey: row.retry_key,
  requestHash: row.request_hash,
  stagingKey: row.staging_key,
  storageKey: row.storage_key,
  uploadUrl: row.upload_url,
  uploadHeaders: row.upload_headers,
  expectedSize: Number(row.expected_size),
  expiresAt: asIso(row.expires_at),
  state: row.state,
  observedEtag: row.observed_etag,
  cleanupAfter: asIso(row.cleanup_after),
  nextRetryAt: asIso(row.next_retry_at),
  retryCount: row.retry_count,
});

interface ItemEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly action: ItemEvent["action"];
  readonly actor: Actor | null;
  readonly payload: ItemEventPayload;
  readonly created_at: Date | string;
}

type PatchResult =
  | { readonly status: "missing" }
  | { readonly status: "conflict" }
  | { readonly status: "limit-exceeded" }
  | { readonly status: "updated"; readonly previous: KevaItem; readonly updated: KevaItem };

const mapEventRow = (row: ItemEventRow): ItemEvent => ({
  id: row.id,
  tenantId: row.tenant_id,
  itemId: row.item_id,
  itemName: row.item_name,
  action: row.action,
  actor: row.actor,
  payload: row.payload,
  createdAt: asIso(row.created_at),
});

const jsonbParam = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);

const insertEvent = async (sql: Sql, event: ItemEvent): Promise<void> => {
  await sql`
    insert into item_events (id, tenant_id, item_id, item_name, action, actor, payload, created_at)
    values (
      ${event.id}, ${event.tenantId}, ${event.itemId}, ${event.itemName}, ${event.action},
      ${jsonbParam(event.actor)}::text::jsonb, ${jsonbParam(event.payload)}::text::jsonb, ${event.createdAt}
    )
  `;
};

const encodeEventCursor = (event: ItemEvent): string =>
  btoa(JSON.stringify([event.createdAt, event.id]));

const dbFailure = (): Internal => new Internal({ message: "Metadata store unavailable" });

const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, KevaError> =>
  Effect.tryPromise({ try: operation, catch: dbFailure });

const decodeCursor = (cursor: string): Effect.Effect<Cursor, ValidationError> => {
  const decoded = decodeSharedCursor(cursor);
  return decoded
    ? Effect.succeed(decoded)
    : Effect.fail(new ValidationError({ message: "Invalid query cursor" }));
};

const invalidCursor = () => new ValidationError({ message: "Cursor does not match query order" });

const decodeQueryCursor = (
  cursor: string,
  order: QueryOrder,
): Effect.Effect<Cursor, ValidationError> =>
  Effect.flatMap(decodeCursor(cursor), (decoded) =>
    (order.startsWith("size_") ? typeof decoded[0] === "number" : typeof decoded[0] === "string") &&
    (decoded[2] === order || (decoded[2] === undefined && order.startsWith("created_at_")))
      ? Effect.succeed(decoded)
      : Effect.fail(invalidCursor()),
  );

const decodeEventCursor = (
  cursor: string,
): Effect.Effect<readonly [string, string], ValidationError> =>
  Effect.flatMap(decodeCursor(cursor), (decoded) =>
    typeof decoded[0] === "string" && decoded[2] === undefined
      ? Effect.succeed([decoded[0], decoded[1]] as const)
      : Effect.fail(invalidCursor()),
  );

type Fragment = ReturnType<Sql["unsafe"]>;
type CursorPredicate = (cursor: Cursor) => Fragment;

const systemColumn = (
  sql: Sql,
  key: string,
): {
  fragment: Fragment;
  type: "string" | "number" | "nullable-string" | "timestamp";
} | null => {
  const field = FIELD_BY_KEY.get(key);
  return field ? { fragment: sql.unsafe(field.column), type: field.queryType } : null;
};

const comparison = (sql: Sql, operator: string): Fragment => {
  const allowed: Record<string, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };
  return sql.unsafe(allowed[operator] ?? "=");
};

// OR-join a list of fragments into `(a or b or …)`. An empty list matches
// nothing (an `in` with no compatible members can never be satisfied).
const anyOf = (sql: Sql, fragments: readonly Fragment[]): Fragment =>
  fragments.length === 0
    ? sql`false`
    : sql`(${fragments.reduce((left, right) => sql`${left} or ${right}`)})`;

const compileCondition = (sql: Sql, condition: QueryCondition): Fragment => {
  const column = systemColumn(sql, condition.key);
  const value = condition.value;
  if (column) {
    if (condition.op === "exists") return sql`${column.fragment} is not null`;
    if (condition.op === "missing") return sql`${column.fragment} is null`;
    if (condition.op === "eq") {
      return value === null
        ? sql`${column.fragment} is null`
        : sql`${column.fragment} = ${value as string | number}`;
    }
    if (condition.op === "neq") {
      return value === null
        ? sql`${column.fragment} is not null`
        : sql`(${column.fragment} is null or ${column.fragment} <> ${value as string | number})`;
    }
    if (condition.op === "contains_text") {
      return sql`position(${value as string} in ${column.fragment}) > 0`;
    }
    if (condition.op === "contains_any") {
      return anyOf(
        sql,
        (value as readonly string[]).map(
          (member) => sql`position(${member} in ${column.fragment}) > 0`,
        ),
      );
    }
    return sql`${column.fragment} ${comparison(sql, condition.op)} ${value as string | number}`;
  }

  const key = condition.key;
  if (condition.op === "exists") return sql`properties ? ${key}`;
  if (condition.op === "missing") return sql`not (properties ? ${key})`;
  if (condition.op === "is_tag") return sql`properties -> ${key} = 'null'::jsonb`;
  const hasValue = (member: string): Fragment => {
    const arrayMatch = sql`(jsonb_typeof(properties -> ${key}) = 'array' and (properties -> ${key}) @> ${jsonbParam([member])}::text::jsonb)`;
    return sql`(${arrayMatch} or (jsonb_typeof(properties -> ${key}) = 'string' and properties ->> ${key} = ${member}))`;
  };
  const containsText = (text: string): Fragment => sql`(
    (jsonb_typeof(properties -> ${key}) = 'string' and position(${text} in properties ->> ${key}) > 0)
    or (jsonb_typeof(properties -> ${key}) = 'array' and exists (
      select 1 from jsonb_array_elements_text(properties -> ${key}) as member
      where position(${text} in member) > 0
    ))
  )`;
  if (condition.op === "has_value") return hasValue(value as string);
  if (condition.op === "has_any") {
    return anyOf(sql, (value as readonly string[]).map(hasValue));
  }
  if (condition.op === "has_all") {
    return (value as readonly string[])
      .map(hasValue)
      .reduce((left, right) => sql`${left} and ${right}`);
  }
  if (condition.op === "contains_text") return containsText(value as string);
  if (condition.op === "contains_any") {
    return anyOf(sql, (value as readonly string[]).map(containsText));
  }
  return sql`false`;
};

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const queryOrder = (
  sql: Sql,
  order: QueryOrder,
): {
  readonly by: Fragment;
  readonly afterCursor: CursorPredicate;
  readonly cursorFor: (item: KevaItem) => Cursor;
} => {
  if (order === "created_at_desc") {
    return {
      by: sql`created_at desc, id desc`,
      afterCursor: (cursor) =>
        sql`(created_at, id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.createdAt, item.id],
    };
  }
  if (order === "created_at_asc") {
    return {
      by: sql`created_at asc, id asc`,
      afterCursor: (cursor) =>
        sql`(created_at, id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.createdAt, item.id],
    };
  }
  const size = sql`coalesce(size, declared_size)`;
  if (order === "size_desc") {
    return {
      by: sql`${size} desc, id desc`,
      afterCursor: (cursor) => sql`(${size}, id) < (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.size ?? item.declaredSize, item.id],
    };
  }
  return {
    by: sql`${size} asc, id asc`,
    afterCursor: (cursor) => sql`(${size}, id) > (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
    cursorFor: (item) => [item.size ?? item.declaredSize, item.id],
  };
};

// Reserve tenant storage inside an open transaction: locks the tenant_usage
// row, checks the quota, and adds the declared size. Returns false (leaving the
// transaction to roll back) when the quota would be exceeded.
type ReservationOutcome =
  | { readonly status: "ok"; readonly periodStart: string | null }
  | { readonly status: "storage" | "items" | "uploads" | "subscription" };

const reserveTenantQuota = async (
  transaction: Sql,
  tenantId: string,
  declaredSize: number,
): Promise<ReservationOutcome> => {
  await transaction`
    insert into tenant_usage (tenant_id, used_bytes, used_items, quota_bytes, quota_items)
    values (${tenantId}, 0, 0, ${DEFAULT_STORAGE_QUOTA_BYTES}, null)
    on conflict (tenant_id) do nothing
  `;
  const usage = await transaction<
    {
      used_bytes: string;
      used_items: string;
      quota_bytes: string | null;
      quota_items: string | null;
    }[]
  >`
    select used_bytes, used_items, quota_bytes, quota_items
    from tenant_usage where tenant_id = ${tenantId} for update
  `;
  const current = usage[0]!;
  const usedBytes = Number(current.used_bytes);
  const usedItems = Number(current.used_items);
  const quotaBytes = current.quota_bytes === null ? null : Number(current.quota_bytes);
  const quotaItems = current.quota_items === null ? null : Number(current.quota_items);
  const billing = await transaction<
    {
      status: string;
      grace_ends_at: Date | string | null;
      trial_ends_at: Date | string | null;
      current_period_start: Date | string | null;
      current_period_end: Date | string | null;
      monthly_uploads_limit: string;
    }[]
  >`
    select status, grace_ends_at, trial_ends_at, current_period_start, current_period_end,
           monthly_uploads_limit
    from tenant_billing where tenant_id = ${tenantId} for update
  `;
  let periodStart: string | null = null;
  const entitlement = billing[0];
  if (entitlement) {
    const allowed =
      entitlement.status === "active" ||
      (entitlement.status === "trialing" &&
        entitlement.trial_ends_at !== null &&
        new Date(entitlement.trial_ends_at) > new Date()) ||
      (entitlement.status === "past_due" &&
        entitlement.grace_ends_at !== null &&
        new Date(entitlement.grace_ends_at) > new Date());
    if (!allowed || !entitlement.current_period_start || !entitlement.current_period_end) {
      return { status: "subscription" };
    }
    if (quotaBytes !== null && usedBytes + declaredSize > quotaBytes) return { status: "storage" };
    if (quotaItems !== null && usedItems + 1 > quotaItems) return { status: "items" };
    periodStart = asIso(entitlement.current_period_start);
    const periodEnd = asIso(entitlement.current_period_end);
    await transaction`
      insert into tenant_period_usage (
        tenant_id, period_start, period_end, uploads_used, uploads_reserved, api_requests_used
      ) values (${tenantId}, ${periodStart}, ${periodEnd}, 0, 0, 0)
      on conflict (tenant_id, period_start) do nothing
    `;
    const periods = await transaction<{ uploads_used: string; uploads_reserved: string }[]>`
      select uploads_used, uploads_reserved from tenant_period_usage
      where tenant_id = ${tenantId} and period_start = ${periodStart}
      for update
    `;
    const uploads = Number(periods[0]!.uploads_used) + Number(periods[0]!.uploads_reserved);
    if (uploads + 1 > Number(entitlement.monthly_uploads_limit)) {
      return { status: "uploads" };
    }
    await transaction`
      update tenant_period_usage set uploads_reserved = uploads_reserved + 1
      where tenant_id = ${tenantId} and period_start = ${periodStart}
    `;
  }
  if (!entitlement) {
    if (quotaBytes !== null && usedBytes + declaredSize > quotaBytes) return { status: "storage" };
    if (quotaItems !== null && usedItems + 1 > quotaItems) return { status: "items" };
  }
  await transaction`
    update tenant_usage
    set used_bytes = used_bytes + ${declaredSize}, used_items = used_items + 1
    where tenant_id = ${tenantId}
  `;
  return { status: "ok", periodStart };
};

const insertItemRow = async (
  transaction: Sql,
  item: KevaItem,
  periodStart: string | null,
): Promise<void> => {
  const properties = canonicalizeProperties(item.properties);
  await transaction`
    insert into items (
      id, tenant_id, name, content_type, declared_size, size, etag,
      source, status, storage_key, staging_key, created_at,
      updated_at, properties, upload_period_start, upload_reservation_state
    ) values (
      ${item.id}, ${item.tenantId}, ${item.name}, ${item.contentType},
      ${item.declaredSize}, ${item.size}, ${item.etag},
      ${item.source}, ${item.status}, ${item.storageKey},
      ${item.stagingKey}, ${item.createdAt}, ${item.updatedAt},
      ${jsonbParam(properties)}::text::jsonb, ${periodStart}, ${periodStart ? "reserved" : null}
    )
  `;
};

export const makePostgresMetadataStore = (sql: Sql): MetadataStoreService => ({
  insert: (item) =>
    Effect.gen(function* () {
      const reserved = yield* attempt(() =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as Sql;
          const reservation = await reserveTenantQuota(tx, item.tenantId, item.declaredSize);
          if (reservation.status !== "ok") return reservation.status;
          await insertItemRow(tx, item, reservation.periodStart);
          return "ok" as const;
        }),
      );
      if (reserved === "subscription") {
        return yield* new SubscriptionRequired({ message: "An active subscription is required" });
      }
      if (reserved === "items") return yield* new QuotaExceeded({ message: "Item limit reached" });
      if (reserved === "uploads") {
        return yield* new QuotaExceeded({ message: "Monthly upload limit reached" });
      }
      if (reserved === "storage") {
        return yield* new QuotaExceeded({ message: "Storage limit reached" });
      }
    }),
  createUpload: (item, uploadAttempt, shareReservation) =>
    Effect.gen(function* () {
      const outcome = yield* attempt(() =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as Sql;
          if (uploadAttempt.retryKey) {
            await tx`select pg_advisory_xact_lock(hashtextextended(${`${item.tenantId}:retry:${uploadAttempt.retryKey}`}, 0))`;
            const existing = await tx<UploadAttemptRow[]>`
              select * from upload_attempts
              where tenant_id = ${item.tenantId} and retry_key = ${uploadAttempt.retryKey}
              for update
            `;
            if (existing[0]) {
              if (existing[0].request_hash !== uploadAttempt.requestHash)
                return { status: "conflict" as const };
              const items = await tx<ItemRow[]>`
                select * from items where tenant_id = ${item.tenantId} and id = ${existing[0].item_id} limit 1
              `;
              if (items[0])
                return {
                  status: "reused" as const,
                  item: mapRow(items[0]),
                  attempt: mapAttemptRow(existing[0]),
                };
            }
          }
          if (shareReservation) {
            const source = `share:${shareReservation.grantId}`;
            await tx`select pg_advisory_xact_lock(hashtextextended(${`${item.tenantId}:${shareReservation.grantId}`}, 0))`;
            const usage = await tx<{ count: string; bytes: string }[]>`
              select count(*)::bigint as count, coalesce(sum(coalesce(size, declared_size)), 0)::bigint as bytes
              from items where tenant_id = ${item.tenantId} and source = ${source}
                and status in ('pending', 'confirming', 'ready')
            `;
            if (
              (shareReservation.maxItems !== null &&
                Number(usage[0]!.count) + 1 > shareReservation.maxItems) ||
              (shareReservation.maxTotalBytes !== null &&
                Number(usage[0]!.bytes) + item.declaredSize > shareReservation.maxTotalBytes)
            )
              return { status: "share" as const };
          }
          const reservation = await reserveTenantQuota(tx, item.tenantId, item.declaredSize);
          if (reservation.status !== "ok") return { status: reservation.status };
          await insertItemRow(tx, item, reservation.periodStart);
          await tx`
            insert into upload_attempts (id, tenant_id, item_id, retry_key, request_hash, staging_key, storage_key,
              upload_url, upload_headers,
              expected_size, expires_at, state, observed_etag, cleanup_after, next_retry_at, retry_count)
            values (${uploadAttempt.id}, ${uploadAttempt.tenantId}, ${uploadAttempt.itemId}, ${uploadAttempt.retryKey},
              ${uploadAttempt.requestHash}, ${uploadAttempt.stagingKey}, ${uploadAttempt.storageKey},
              ${uploadAttempt.uploadUrl}, ${jsonbParam(uploadAttempt.uploadHeaders)}::text::jsonb, ${uploadAttempt.expectedSize},
              ${uploadAttempt.expiresAt}, ${uploadAttempt.state}, ${uploadAttempt.observedEtag},
              ${uploadAttempt.cleanupAfter}, ${uploadAttempt.nextRetryAt}, ${uploadAttempt.retryCount})
          `;
          return { status: "created" as const };
        }),
      );
      if (outcome.status === "conflict")
        return yield* new Conflict({
          message: "Retry key was already used for a different upload",
        });
      if (outcome.status === "share")
        return yield* new QuotaExceeded({ message: "Share storage limit reached" });
      if (outcome.status === "subscription")
        return yield* new SubscriptionRequired({ message: "An active subscription is required" });
      if (outcome.status === "items")
        return yield* new QuotaExceeded({ message: "Item limit reached" });
      if (outcome.status === "uploads")
        return yield* new QuotaExceeded({ message: "Monthly upload limit reached" });
      if (outcome.status === "storage")
        return yield* new QuotaExceeded({ message: "Storage limit reached" });
      return outcome.status === "reused"
        ? { item: outcome.item, attempt: outcome.attempt, reused: true }
        : { item, attempt: uploadAttempt, reused: false };
    }),
  reserveShareUpload: (reservation) =>
    Effect.gen(function* () {
      const source = `share:${reservation.grantId}`;
      const outcome = yield* attempt(() =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as Sql;
          if (reservation.item.source !== source) throw new Error("share source mismatch");
          await tx`select pg_advisory_xact_lock(hashtextextended(${`${reservation.item.tenantId}:${reservation.grantId}`}, 0))`;
          const usage = await tx<{ count: string; bytes: string }[]>`
            select count(*)::bigint as count,
                   coalesce(sum(coalesce(size, declared_size)), 0)::bigint as bytes
            from items
            where tenant_id = ${reservation.item.tenantId}
              and source = ${source}
              and status in ('pending', 'confirming', 'ready')
          `;
          const current = usage[0]!;
          if (
            (reservation.maxItems !== null && Number(current.count) + 1 > reservation.maxItems) ||
            (reservation.maxTotalBytes !== null &&
              Number(current.bytes) + reservation.item.declaredSize > reservation.maxTotalBytes)
          ) {
            return "share" as const;
          }
          const tenantReservation = await reserveTenantQuota(
            tx,
            reservation.item.tenantId,
            reservation.item.declaredSize,
          );
          if (tenantReservation.status !== "ok") return tenantReservation.status;
          await insertItemRow(tx, reservation.item, tenantReservation.periodStart);
          return "ok" as const;
        }),
      );
      if (outcome === "share") {
        return yield* new QuotaExceeded({ message: "Share storage limit reached" });
      }
      if (outcome === "subscription") {
        return yield* new SubscriptionRequired({ message: "An active subscription is required" });
      }
      if (outcome === "items") return yield* new QuotaExceeded({ message: "Item limit reached" });
      if (outcome === "uploads") {
        return yield* new QuotaExceeded({ message: "Monthly upload limit reached" });
      }
      if (outcome === "storage")
        return yield* new QuotaExceeded({ message: "Storage limit reached" });
    }),
  get: (tenantId, id) =>
    attempt(async () => {
      const rows = await sql<ItemRow[]>`
        select * from items where tenant_id = ${tenantId} and id = ${id} limit 1
      `;
      return rows[0] ? mapRow(rows[0]) : null;
    }),
  transition: (tenantId, id, from, patch, olderThan) =>
    attempt(async () => {
      const values: Record<string, unknown> = {
        updated_at: patch.updatedAt,
      };
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.size !== undefined) values.size = patch.size;
      if (patch.etag !== undefined) values.etag = patch.etag;
      if (patch.contentType !== undefined) values.content_type = patch.contentType;
      return sql.begin(async (transaction) => {
        const rows =
          olderThan === undefined
            ? await transaction<ItemRow[]>`
              select * from items where tenant_id = ${tenantId} and id = ${id}
                and status in ${transaction(from)} for update
            `
            : await transaction<ItemRow[]>`
              select * from items where tenant_id = ${tenantId} and id = ${id}
                and status in ${transaction(from)} and created_at < ${olderThan} for update
            `;
        const row = rows[0];
        if (!row) return false;
        if (patch.status === "deleting" && row.upload_reservation_state === "reserved") {
          await transaction`
            update tenant_period_usage
            set uploads_reserved = greatest(0, uploads_reserved - 1)
            where tenant_id = ${tenantId} and period_start = ${row.upload_period_start}
          `;
          values.upload_reservation_state = null;
        }
        await transaction`
          update items set ${transaction(values)} where tenant_id = ${tenantId} and id = ${id}
        `;
        return true;
      });
    }),
  transitionWithEvent: (tenantId, id, from, patch, event) =>
    attempt(async () =>
      sql.begin(async (transaction) => {
        const rows = await transaction<ItemRow[]>`
          select * from items where tenant_id = ${tenantId} and id = ${id} and status in ${transaction(from)} for update
        `;
        const row = rows[0];
        if (!row) return null;
        const values: Record<string, unknown> = { updated_at: patch.updatedAt };
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.size !== undefined) values.size = patch.size;
        if (patch.etag !== undefined) values.etag = patch.etag;
        if (patch.contentType !== undefined) values.content_type = patch.contentType;
        if (patch.status === "ready" && row.upload_reservation_state === "reserved") {
          await transaction`
            update tenant_period_usage
            set uploads_reserved = greatest(0, uploads_reserved - 1), uploads_used = uploads_used + 1
            where tenant_id = ${tenantId} and period_start = ${row.upload_period_start}
          `;
          values.upload_reservation_state = "consumed";
        } else if (patch.status === "deleting" && row.upload_reservation_state === "reserved") {
          await transaction`
            update tenant_period_usage
            set uploads_reserved = greatest(0, uploads_reserved - 1)
            where tenant_id = ${tenantId} and period_start = ${row.upload_period_start}
          `;
          values.upload_reservation_state = null;
        }
        const updated = await transaction<ItemRow[]>`
          update items set ${transaction(values)} where tenant_id = ${tenantId} and id = ${id} returning *
        `;
        if (!updated[0]) return null;
        const item = mapRow(updated[0]);
        await insertEvent(transaction as unknown as Sql, event(item));
        return item;
      }),
    ),
  patch: (tenantId, id, patch, updatedAt, expectedRevision) =>
    Effect.gen(function* () {
      const result: PatchResult = yield* attempt(async () => {
        return sql.begin(async (transaction): Promise<PatchResult> => {
          const rows = await transaction<ItemRow[]>`
          select * from items
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          for update
        `;
          const row = rows[0];
          if (!row) return { status: "missing" };
          if (expectedRevision !== undefined && row.revision !== expectedRevision)
            return { status: "conflict" } as PatchResult;
          const properties = { ...row.properties, ...patch.set };
          for (const key of patch.unset) delete properties[key];
          if (validateProperties(properties) !== null) return { status: "limit-exceeded" };
          // `updated_at` is always present, so `sql(values)` is never empty and
          // the inline `properties` clause always has a valid leading comma.
          const values: Record<string, unknown> = {
            updated_at: updatedAt,
            revision: row.revision + 1,
          };
          for (const [key, value] of Object.entries(patch.fields)) {
            const field = FIELD_BY_KEY.get(key);
            if (field) values[field.column] = value;
          }
          const updated = await transaction<ItemRow[]>`
          update items
          set ${transaction(values)}, properties = ${jsonbParam(properties)}::text::jsonb
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          returning *
        `;
          return updated[0]
            ? { status: "updated", previous: mapRow(row), updated: mapRow(updated[0]) }
            : { status: "missing" };
        });
      });
      if (result.status === "limit-exceeded") {
        return yield* new QuotaExceeded({ message: "Property limits exceeded" });
      }
      if (result.status === "conflict")
        return yield* new Conflict({ message: "Item revision changed" });
      return result.status === "updated"
        ? { previous: result.previous, updated: result.updated }
        : null;
    }),
  patchWithEvent: (tenantId, id, patch, updatedAt, expectedRevision, event) =>
    Effect.gen(function* () {
      const result: PatchResult = yield* attempt(async () =>
        sql.begin(async (transaction): Promise<PatchResult> => {
          const rows = await transaction<ItemRow[]>`
            select * from items where tenant_id = ${tenantId} and id = ${id} and status = 'ready' for update
          `;
          const row = rows[0];
          if (!row) return { status: "missing" };
          if (expectedRevision !== undefined && row.revision !== expectedRevision)
            return { status: "conflict" } as PatchResult;
          const properties = { ...row.properties, ...patch.set };
          for (const key of patch.unset) delete properties[key];
          if (validateProperties(properties) !== null) return { status: "limit-exceeded" };
          const values: Record<string, unknown> = {
            updated_at: updatedAt,
            revision: row.revision + 1,
          };
          for (const [key, value] of Object.entries(patch.fields)) {
            const field = FIELD_BY_KEY.get(key);
            if (field) values[field.column] = value;
          }
          const updated = await transaction<ItemRow[]>`
            update items set ${transaction(values)}, properties = ${jsonbParam(properties)}::text::jsonb
            where tenant_id = ${tenantId} and id = ${id} and status = 'ready' returning *
          `;
          if (!updated[0]) return { status: "missing" };
          const previous = mapRow(row);
          const next = mapRow(updated[0]);
          const nextEvent = event(previous, next);
          if (nextEvent) await insertEvent(transaction as unknown as Sql, nextEvent);
          return { status: "updated", previous, updated: next };
        }),
      );
      if (result.status === "limit-exceeded") {
        return yield* new QuotaExceeded({ message: "Property limits exceeded" });
      }
      if (result.status === "conflict")
        return yield* new Conflict({ message: "Item revision changed" });
      return result.status === "updated"
        ? { previous: result.previous, updated: result.updated }
        : null;
    }),
  remove: (tenantId, id, expectedStatus) =>
    attempt(async () => {
      return sql.begin(async (transaction) => {
        const rows = await transaction<{ size: string | null; declared_size: string }[]>`
          delete from items
          where tenant_id = ${tenantId} and id = ${id} and status = ${expectedStatus}
          returning size, declared_size
        `;
        const row = rows[0];
        if (!row) return false;
        const releasedBytes = Number(row.size ?? row.declared_size);
        await transaction`
          update tenant_usage
          set used_bytes = greatest(0, used_bytes - ${releasedBytes}),
              used_items = greatest(0, used_items - 1)
          where tenant_id = ${tenantId}
        `;
        return true;
      });
    }),
  query: (tenantId, query) =>
    Effect.gen(function* () {
      const order = query.order ?? "created_at_asc";
      const predicates: Fragment[] = [
        sql`tenant_id = ${tenantId}`,
        sql`status = 'ready'`,
        ...query.where.map((condition) => compileCondition(sql, condition)),
      ];
      const search = query.search?.trim();
      if (search) {
        const pattern = `%${escapeLikePattern(search)}%`;
        predicates.push(
          anyOf(
            sql,
            (query.searchFields ?? ["name", "content_type"]).map((field) =>
              field === "name"
                ? sql`name ilike ${pattern} escape '\\'`
                : sql`content_type ilike ${pattern} escape '\\'`,
            ),
          ),
        );
      }
      const orderSql = queryOrder(sql, order);
      if (query.offset !== undefined) {
        const offset = query.offset;
        const where = predicates.reduce((left, right) => sql`${left} and ${right}`);
        const rows = yield* attempt(
          async () =>
            await sql<{ items: ItemRow[]; total_count: string }[]>`
              with page as (
                select * from items
                where ${where}
                order by ${orderSql.by}
                limit ${query.limit} offset ${offset}
              )
              select coalesce(json_agg(page order by ${orderSql.by}), '[]'::json) as items,
                     (select count(*)::bigint from items where ${where}) as total_count
              from page
            `,
        );
        return {
          items: rows[0]!.items.map(mapRow),
          totalCount: Number(rows[0]!.total_count),
        };
      }
      if (query.cursor) {
        const cursor = yield* decodeQueryCursor(query.cursor, order);
        predicates.push(queryOrder(sql, order).afterCursor(cursor));
      }
      const where = predicates.reduce((left, right) => sql`${left} and ${right}`);
      const rows = yield* attempt(
        () =>
          sql<ItemRow[]>`
          select * from items
          where ${where}
          order by ${orderSql.by}
          limit ${query.limit + 1}
        `,
      );
      const items = rows.slice(0, query.limit).map(mapRow);
      const lastItem = rows.length > query.limit ? items.at(-1) : undefined;
      const nextCursor = lastItem ? orderSql.cursorFor(lastItem) : undefined;
      return {
        items,
        ...(nextCursor
          ? {
              nextCursor: encodeCursor([nextCursor[0], nextCursor[1], order]),
            }
          : {}),
      };
    }),
  usage: (tenantId) =>
    attempt(async () => {
      const rows = await sql<{ content_type: string; count: string; bytes: string }[]>`
        select content_type,
               count(*)::bigint as count,
               coalesce(sum(size), 0)::bigint as bytes
        from items
        where tenant_id = ${tenantId} and status = 'ready'
        group by content_type
        order by bytes desc, content_type asc
      `;
      let itemCount = 0;
      let totalBytes = 0;
      const byType = rows.map((row) => {
        const count = Number(row.count);
        const bytes = Number(row.bytes);
        itemCount += count;
        totalBytes += bytes;
        return { contentType: row.content_type, count, bytes };
      });
      const quotaRows = await sql<
        {
          used_bytes: string;
          used_items: string;
          quota_bytes: string | null;
          quota_items: string | null;
        }[]
      >`
        select used_bytes, used_items, quota_bytes, quota_items
        from tenant_usage where tenant_id = ${tenantId}
      `;
      const quotaBytes = quotaRows[0]
        ? quotaRows[0].quota_bytes === null
          ? null
          : Number(quotaRows[0].quota_bytes)
        : DEFAULT_STORAGE_QUOTA_BYTES;
      const accountedBytes = quotaRows[0] ? Number(quotaRows[0].used_bytes) : totalBytes;
      const accountedItems = quotaRows[0] ? Number(quotaRows[0].used_items) : itemCount;
      const quotaItems =
        quotaRows[0]?.quota_items === null || !quotaRows[0]
          ? null
          : Number(quotaRows[0].quota_items);
      const periodRows = await sql<
        {
          period_start: Date | string;
          period_end: Date | string;
          uploads_used: string;
          uploads_reserved: string;
          api_requests_used: string;
          monthly_uploads_limit: string;
          monthly_api_requests_limit: string;
        }[]
      >`
        select p.period_start, p.period_end, p.uploads_used, p.uploads_reserved,
               p.api_requests_used, b.monthly_uploads_limit, b.monthly_api_requests_limit
        from tenant_billing b
        join tenant_period_usage p
          on p.tenant_id = b.tenant_id and p.period_start = b.current_period_start
        where b.tenant_id = ${tenantId}
      `;
      const period = periodRows[0];
      return {
        itemCount,
        totalBytes,
        accountedItems,
        quotaBytes,
        quotaItems,
        remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - accountedBytes),
        remainingItems: quotaItems === null ? null : Math.max(0, quotaItems - accountedItems),
        period: period
          ? {
              startsAt: asIso(period.period_start),
              endsAt: asIso(period.period_end),
              uploadsUsed: Number(period.uploads_used),
              uploadsReserved: Number(period.uploads_reserved),
              uploadsLimit: Number(period.monthly_uploads_limit),
              apiRequestsUsed: Number(period.api_requests_used),
              apiRequestsLimit: Number(period.monthly_api_requests_limit),
            }
          : null,
        byType,
      };
    }),
  setQuota: (tenantId, quotaBytes) =>
    attempt(async () => {
      await sql`
        insert into tenant_usage (tenant_id, used_bytes, used_items, quota_bytes)
        values (
          ${tenantId},
          (
            select coalesce(sum(coalesce(size, declared_size)), 0)::bigint
            from items
            where tenant_id = ${tenantId} and status in ('pending', 'confirming', 'ready', 'deleting')
          ),
          (
            select count(*)::bigint from items
            where tenant_id = ${tenantId} and status in ('pending', 'confirming', 'ready', 'deleting')
          ),
          ${quotaBytes}
        )
        on conflict (tenant_id) do update set quota_bytes = excluded.quota_bytes
      `;
    }),
  sourceUsage: (tenantId, source) =>
    attempt(async () => {
      const rows = await sql<{ count: string; bytes: string }[]>`
        select count(*)::bigint as count,
               coalesce(sum(coalesce(size, declared_size)), 0)::bigint as bytes
        from items
        where tenant_id = ${tenantId} and source = ${source}
          and status in ('pending', 'confirming', 'ready')
      `;
      const row = rows[0];
      return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
    }),
  propertyKeys: (tenantId) =>
    attempt(async () => {
      const rows = await sql<{ key: string }[]>`
        select distinct key
        from item_property_terms
        where tenant_id = ${tenantId}
        order by key
        limit ${SUGGESTION_KEY_LIMIT}
      `;
      return rows.map((row) => row.key);
    }),
  propertyValues: (tenantId, key) =>
    attempt(async () => {
      const rows = await sql<{ value: PropertyScalar }[]>`
        select distinct value
        from item_property_terms
        where tenant_id = ${tenantId} and key = ${key} and value is not null
        order by value
        limit ${SUGGESTION_VALUE_LIMIT}
      `;
      return rows.map((row) => row.value);
    }),
  propertySummary: (tenantId) =>
    attempt(async () => {
      const rows = await sql<
        { key: string; kinds: PropertyKind[]; values: PropertyScalar[] | null }[]
      >`
        with selected_keys as (
          select key, array_agg(distinct kind order by kind) as kinds
          from item_property_terms
          where tenant_id = ${tenantId}
          group by key
          order by key
          limit ${SUGGESTION_KEY_LIMIT}
        ), distinct_values as (
          select distinct terms.key, terms.value
          from item_property_terms terms
          join selected_keys on selected_keys.key = terms.key
          where terms.tenant_id = ${tenantId} and terms.value is not null
        ), ranked_values as (
          select key, value,
                 row_number() over (partition by key order by value) as rank
          from distinct_values
        )
        select selected_keys.key, selected_keys.kinds,
               jsonb_agg(ranked_values.value order by ranked_values.value)
                 filter (where ranked_values.rank <= ${SUGGESTION_VALUE_LIMIT}) as values
        from selected_keys
        left join ranked_values on ranked_values.key = selected_keys.key
        group by selected_keys.key, selected_keys.kinds
        order by selected_keys.key
      `;
      return rows.map((row) => ({
        key: row.key,
        kinds: row.kinds,
        values: row.values ?? [],
      }));
    }),
  propertySuggestions: (tenantId, search, limit) =>
    attempt(async () => {
      const pattern = `%${escapeLikePattern(search)}%`;
      const prefix = `${escapeLikePattern(search)}%`;
      const rows = await sql<{ key: string; value: string | null }[]>`
        with matches as (
          select distinct key, null::text as value
          from item_property_terms
          where tenant_id = ${tenantId} and key ilike ${pattern} escape '\\'
          union
          select distinct key, value
          from item_property_terms
          where tenant_id = ${tenantId} and value is not null
            and value ilike ${pattern} escape '\\'
        )
        select key, value
        from matches
        order by
          case
            when lower(coalesce(value, key)) = lower(${search}) then 0
            when coalesce(value, key) ilike ${prefix} escape '\\' then 1
            else 2
          end,
          lower(coalesce(value, key)), lower(key)
        limit ${limit}
      `;
      return rows.map((row) => ({
        key: row.key,
        ...(row.value === null ? {} : { value: row.value }),
      }));
    }),
  listByStatus: (status, limit, olderThan) =>
    attempt(async () => {
      const rows =
        olderThan === undefined
          ? await sql<ItemRow[]>`
            select * from items where status = ${status}
            order by created_at asc limit ${limit}
          `
          : await sql<ItemRow[]>`
            select * from items
            where status = ${status} and created_at < ${olderThan}
            order by created_at asc limit ${limit}
          `;
      return rows.map(mapRow);
    }),
  listUploadAttemptsForItem: (tenantId, itemId) =>
    attempt(async () => {
      const rows = await sql<UploadAttemptRow[]>`
        select * from upload_attempts where tenant_id = ${tenantId} and item_id = ${itemId}
      `;
      return rows.map(mapAttemptRow);
    }),
  listUploadAttemptsForCleanup: (limit, eligibleAt) =>
    attempt(async () => {
      const rows = await sql<UploadAttemptRow[]>`
        select * from upload_attempts
        where cleanup_after <= ${eligibleAt} and next_retry_at <= ${eligibleAt}
        order by next_retry_at asc, id asc limit ${limit}
      `;
      return rows.map(mapAttemptRow);
    }),
  updateUploadAttempt: (id, patch) =>
    attempt(async () => {
      const values: Record<string, unknown> = {};
      if (patch.state !== undefined) values.state = patch.state;
      if (patch.observedEtag !== undefined) values.observed_etag = patch.observedEtag;
      if (patch.nextRetryAt !== undefined) values.next_retry_at = patch.nextRetryAt;
      if (patch.retryCount !== undefined) values.retry_count = patch.retryCount;
      if (Object.keys(values).length > 0)
        await sql`update upload_attempts set ${sql(values)} where id = ${id}`;
    }),
  removeUploadAttempt: (id) =>
    attempt(
      async () => (await sql`delete from upload_attempts where id = ${id} returning id`).length > 0,
    ),
  appendEvent: (event) =>
    attempt(async () => {
      await sql`
        insert into item_events (
          id, tenant_id, item_id, item_name, action, actor, payload, created_at
        ) values (
          ${event.id}, ${event.tenantId}, ${event.itemId}, ${event.itemName},
          ${event.action}, ${jsonbParam(event.actor)}::text::jsonb,
          ${jsonbParam(event.payload)}::text::jsonb, ${event.createdAt}
        )
      `;
    }),
  listEvents: (tenantId, itemId, options) =>
    Effect.gen(function* () {
      const predicates: Fragment[] = [sql`tenant_id = ${tenantId}`, sql`item_id = ${itemId}`];
      if (options.cursor) {
        const cursor = yield* decodeEventCursor(options.cursor);
        predicates.push(sql`(created_at, id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`);
      }
      const where = predicates.reduce((left, right) => sql`${left} and ${right}`);
      const rows = yield* attempt(
        () =>
          sql<ItemEventRow[]>`
          select * from item_events
          where ${where}
          order by created_at desc, id desc
          limit ${options.limit + 1}
        `,
      );
      const events = rows.slice(0, options.limit).map(mapEventRow);
      return {
        events,
        ...(rows.length > options.limit && events.at(-1)
          ? { nextCursor: encodeEventCursor(events.at(-1)!) }
          : {}),
      };
    }),
});

export const PostgresMetadataStoreLive = (config: PostgresConfig): Layer.Layer<MetadataStore> =>
  Layer.scoped(
    MetadataStore,
    Effect.acquireRelease(
      Effect.sync(() =>
        postgres(config.url, {
          max: config.maxConnections ?? 10,
          idle_timeout: config.idleTimeoutSeconds ?? 20,
          connect_timeout: config.connectTimeoutSeconds ?? 10,
        }),
      ),
      (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
    ).pipe(Effect.map(makePostgresMetadataStore)),
  );
