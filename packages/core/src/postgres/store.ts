import {
  FIELD_BY_KEY,
  canonicalizeProperties,
  decodeCursor as decodeSharedCursor,
  encodeCursor,
  Internal,
  QuotaExceeded,
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
  readonly checksum: string | null;
  readonly source: string;
  readonly status: "pending" | "ready" | "deleting";
  readonly storage_key: string;
  readonly staging_key: string;
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
  checksum: row.checksum,
  source: row.source,
  status: row.status,
  storageKey: row.storage_key,
  stagingKey: row.staging_key,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
  properties: canonicalizeProperties(row.properties),
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
const reserveTenantQuota = async (
  transaction: Sql,
  tenantId: string,
  declaredSize: number,
): Promise<boolean> => {
  await transaction`
    insert into tenant_usage (tenant_id, used_bytes, quota_bytes)
    values (${tenantId}, 0, ${DEFAULT_STORAGE_QUOTA_BYTES})
    on conflict (tenant_id) do nothing
  `;
  const usage = await transaction<{ used_bytes: string; quota_bytes: string | null }[]>`
    select used_bytes, quota_bytes from tenant_usage where tenant_id = ${tenantId} for update
  `;
  const current = usage[0]!;
  const usedBytes = Number(current.used_bytes);
  const quotaBytes = current.quota_bytes === null ? null : Number(current.quota_bytes);
  if (quotaBytes !== null && usedBytes + declaredSize > quotaBytes) return false;
  await transaction`
    update tenant_usage set used_bytes = used_bytes + ${declaredSize} where tenant_id = ${tenantId}
  `;
  return true;
};

const insertItemRow = async (transaction: Sql, item: KevaItem): Promise<void> => {
  const properties = canonicalizeProperties(item.properties);
  await transaction`
    insert into items (
      id, tenant_id, name, content_type, declared_size, size, etag,
      checksum, source, status, storage_key, staging_key, created_at,
      updated_at, properties
    ) values (
      ${item.id}, ${item.tenantId}, ${item.name}, ${item.contentType},
      ${item.declaredSize}, ${item.size}, ${item.etag}, ${item.checksum},
      ${item.source}, ${item.status}, ${item.storageKey},
      ${item.stagingKey}, ${item.createdAt}, ${item.updatedAt},
      ${jsonbParam(properties)}::text::jsonb
    )
  `;
};

export const makePostgresMetadataStore = (sql: Sql): MetadataStoreService => ({
  insert: (item) =>
    Effect.gen(function* () {
      const reserved = yield* attempt(() =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as Sql;
          if (!(await reserveTenantQuota(tx, item.tenantId, item.declaredSize))) return false;
          await insertItemRow(tx, item);
          return true;
        }),
      );
      if (!reserved) return yield* new QuotaExceeded({ message: "Storage limit reached" });
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
              and status in ('pending', 'ready')
          `;
          const current = usage[0]!;
          if (
            (reservation.maxItems !== null && Number(current.count) + 1 > reservation.maxItems) ||
            (reservation.maxTotalBytes !== null &&
              Number(current.bytes) + reservation.item.declaredSize > reservation.maxTotalBytes)
          ) {
            return "share" as const;
          }
          if (
            !(await reserveTenantQuota(
              tx,
              reservation.item.tenantId,
              reservation.item.declaredSize,
            ))
          ) {
            return "tenant" as const;
          }
          await insertItemRow(tx, reservation.item);
          return "ok" as const;
        }),
      );
      if (outcome === "share") {
        return yield* new QuotaExceeded({ message: "Share storage limit reached" });
      }
      if (outcome === "tenant") {
        return yield* new QuotaExceeded({ message: "Storage limit reached" });
      }
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
      const rows =
        olderThan === undefined
          ? await sql`
            update items set ${sql(values)}
            where tenant_id = ${tenantId} and id = ${id}
              and status in ${sql(from)}
            returning id
          `
          : await sql`
            update items set ${sql(values)}
            where tenant_id = ${tenantId} and id = ${id}
              and status in ${sql(from)} and created_at < ${olderThan}
            returning id
          `;
      return rows.length === 1;
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
        const updated = await transaction<ItemRow[]>`
          update items set ${transaction(values)} where tenant_id = ${tenantId} and id = ${id} returning *
        `;
        if (!updated[0]) return null;
        const item = mapRow(updated[0]);
        await insertEvent(transaction as unknown as Sql, event(item));
        return item;
      }),
    ),
  patch: (tenantId, id, patch, updatedAt) =>
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
          const properties = { ...row.properties, ...patch.set };
          for (const key of patch.unset) delete properties[key];
          if (validateProperties(properties) !== null) return { status: "limit-exceeded" };
          // `updated_at` is always present, so `sql(values)` is never empty and
          // the inline `properties` clause always has a valid leading comma.
          const values: Record<string, unknown> = { updated_at: updatedAt };
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
      return result.status === "updated"
        ? { previous: result.previous, updated: result.updated }
        : null;
    }),
  patchWithEvent: (tenantId, id, patch, updatedAt, event) =>
    Effect.gen(function* () {
      const result: PatchResult = yield* attempt(async () =>
        sql.begin(async (transaction): Promise<PatchResult> => {
          const rows = await transaction<ItemRow[]>`
            select * from items where tenant_id = ${tenantId} and id = ${id} and status = 'ready' for update
          `;
          const row = rows[0];
          if (!row) return { status: "missing" };
          const properties = { ...row.properties, ...patch.set };
          for (const key of patch.unset) delete properties[key];
          if (validateProperties(properties) !== null) return { status: "limit-exceeded" };
          const values: Record<string, unknown> = { updated_at: updatedAt };
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
          set used_bytes = greatest(0, used_bytes - ${releasedBytes})
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
          sql`(name ilike ${pattern} escape '\' or content_type ilike ${pattern} escape '\')`,
        );
      }
      if (query.cursor) {
        const cursor = yield* decodeQueryCursor(query.cursor, order);
        predicates.push(queryOrder(sql, order).afterCursor(cursor));
      }
      const orderSql = queryOrder(sql, order);
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
      const quotaRows = await sql<{ used_bytes: string; quota_bytes: string | null }[]>`
        select used_bytes, quota_bytes from tenant_usage where tenant_id = ${tenantId}
      `;
      const quotaBytes = quotaRows[0]
        ? quotaRows[0].quota_bytes === null
          ? null
          : Number(quotaRows[0].quota_bytes)
        : DEFAULT_STORAGE_QUOTA_BYTES;
      const accountedBytes = quotaRows[0] ? Number(quotaRows[0].used_bytes) : totalBytes;
      return {
        itemCount,
        totalBytes,
        quotaBytes,
        remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - accountedBytes),
        byType,
      };
    }),
  setQuota: (tenantId, quotaBytes) =>
    attempt(async () => {
      await sql`
        insert into tenant_usage (tenant_id, used_bytes, quota_bytes)
        values (
          ${tenantId},
          (
            select coalesce(sum(coalesce(size, declared_size)), 0)::bigint
            from items
            where tenant_id = ${tenantId} and status in ('pending', 'ready')
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
          and status in ('pending', 'ready')
      `;
      const row = rows[0];
      return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
    }),
  propertyKeys: (tenantId) =>
    attempt(async () => {
      // Fan out each item's top-level property keys, then dedupe across the
      // tenant. The GIN index doesn't serve this, but distinct key counts are
      // small and the row scan is bounded by the tenant's ready items.
      const rows = await sql<{ key: string }[]>`
        select distinct k as key
        from items, lateral jsonb_object_keys(properties) as k
        where tenant_id = ${tenantId} and status = 'ready'
        order by key
        limit ${SUGGESTION_KEY_LIMIT}
      `;
      return rows.map((row) => row.key);
    }),
  propertyValues: (tenantId, key) =>
    attempt(async () => {
      const rows = await sql<{ value: PropertyScalar }[]>`
        select distinct value
        from items, lateral (
          select properties ->> ${key} as value
          where jsonb_typeof(properties -> ${key}) = 'string'
          union all
          select jsonb_array_elements_text(properties -> ${key}) as value
          where jsonb_typeof(properties -> ${key}) = 'array'
        ) discovered
        where tenant_id = ${tenantId} and status = 'ready'
        order by value
        limit ${SUGGESTION_VALUE_LIMIT}
      `;
      return rows.map((row) => row.value);
    }),
  propertySummary: (tenantId) =>
    attempt(async () => {
      // jsonb 'null' surfaces as the product kind "tag" (bare membership tag).
      const rows = await sql<
        { key: string; kinds: PropertyKind[]; values: PropertyScalar[] | null }[]
      >`
        with kv as (
          select k.key as key,
                 jsonb_typeof(properties -> k.key) as kind,
                 properties -> k.key as value
          from items, lateral jsonb_object_keys(properties) as k(key)
          where tenant_id = ${tenantId} and status = 'ready'
        ), kinds as (
          select key,
                 array_agg(distinct case when kind = 'null' then 'tag' else kind end) as kinds
          from kv
          group by key
        ), scalar_values as (
          select distinct key, value #>> '{}' as value
          from kv where kind = 'string'
          union
          select distinct kv.key, member.value
          from kv, lateral jsonb_array_elements_text(kv.value) as member(value)
          where kind = 'array'
        ), ranked_values as (
          select key, value,
                 row_number() over (partition by key order by value) as rank
          from scalar_values
        )
        select kinds.key, kinds.kinds,
               jsonb_agg(ranked_values.value order by ranked_values.value)
                 filter (where ranked_values.rank <= ${SUGGESTION_VALUE_LIMIT}) as values
        from kinds
        left join ranked_values on ranked_values.key = kinds.key
        group by kinds.key, kinds.kinds
        order by kinds.key
        limit ${SUGGESTION_KEY_LIMIT}
      `;
      return rows.map((row) => ({
        key: row.key,
        kinds: row.kinds,
        values: row.values ?? [],
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
  listStagingUncleaned: (limit) =>
    attempt(async () => {
      const rows = await sql<ItemRow[]>`
        select * from items
        where status = 'ready' and staging_cleaned_at is null
        order by created_at asc limit ${limit}
      `;
      return rows.map(mapRow);
    }),
  markStagingCleaned: (tenantId, id) =>
    attempt(async () => {
      await sql`
        update items set staging_cleaned_at = now()
        where tenant_id = ${tenantId} and id = ${id}
      `;
    }),
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
