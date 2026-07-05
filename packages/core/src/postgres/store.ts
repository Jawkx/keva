import {
  FIELD_BY_KEY,
  ITEM_ID_PATTERN,
  Internal,
  ValidationError,
  type KevaError,
  type KevaItem,
  type PropertyScalar,
  type QueryCondition,
  type QueryOrder,
} from "@keva/schema";
import { Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";
import {
  MetadataStore,
  type MetadataStoreService,
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
  properties: row.properties,
});

const dbFailure = (): Internal => new Internal({ message: "Metadata store unavailable" });

const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, KevaError> =>
  Effect.tryPromise({ try: operation, catch: dbFailure });

const encodeCursor = (item: KevaItem): string => btoa(JSON.stringify([item.createdAt, item.id]));

const decodeCursor = (cursor: string): Effect.Effect<readonly [string, string], ValidationError> =>
  Effect.try({
    try: () => {
      const value = JSON.parse(atob(cursor)) as unknown;
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof value[0] !== "string" ||
        typeof value[1] !== "string" ||
        !Number.isFinite(Date.parse(value[0])) ||
        !ITEM_ID_PATTERN.test(value[1])
      )
        throw new Error("invalid cursor");
      return [value[0], value[1]] as const;
    },
    catch: () => new ValidationError({ message: "Invalid query cursor" }),
  });

type Fragment = ReturnType<Sql["unsafe"]>;
type CursorPredicate = (cursor: readonly [string, string]) => Fragment;

// A query key backed by a real column (declared in the schema field registry),
// as opposed to a key that lives inside the `properties` JSONB blob.
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

const compileCondition = (sql: Sql, condition: QueryCondition): Fragment => {
  const column = systemColumn(sql, condition.key);
  const value = condition.value;
  if (column) {
    if (condition.op === "exists") return sql`true`;
    const expected = column.type === "number" ? "number" : "string";
    const typeMismatch = value !== null && typeof value !== expected;
    // Type-strict values of different types are necessarily unequal, but cannot
    // match equality, ordering, or contains comparisons.
    if (condition.op === "neq" && typeMismatch) return sql`true`;
    if (typeMismatch) return sql`false`;
    if (condition.op === "eq") {
      return value === null
        ? sql`${column.fragment} is null`
        : sql`${column.fragment} = ${value as string | number}`;
    }
    if (condition.op === "neq") {
      return value === null
        ? sql`${column.fragment} is not null`
        : sql`${column.fragment} is not null and ${column.fragment} <> ${value as string | number}`;
    }
    if (condition.op === "contains") {
      return typeof value === "string" && column.type !== "number"
        ? sql`position(${value} in ${column.fragment}) > 0`
        : sql`false`;
    }
    return sql`${column.fragment} ${comparison(sql, condition.op)} ${value as string | number}`;
  }

  const key = condition.key;
  if (condition.op === "exists") return sql`properties ? ${key}`;
  if (condition.op === "eq") {
    return sql`properties @> ${sql.json({ [key]: value })}`;
  }
  if (condition.op === "neq") {
    return sql`properties ? ${key} and not (properties @> ${sql.json({ [key]: value })})`;
  }
  if (condition.op === "contains") {
    const member = value as string | number | boolean;
    const arrayMatch = sql`(jsonb_typeof(properties -> ${key}) = 'array' and (properties -> ${key}) @> ${sql.json([member])})`;
    return typeof value === "string"
      ? sql`(${arrayMatch} or (jsonb_typeof(properties -> ${key}) = 'string' and position(${value} in properties ->> ${key}) > 0))`
      : arrayMatch;
  }
  if (typeof value === "number") {
    return sql`(jsonb_typeof(properties -> ${key}) = 'number' and (properties ->> ${key})::numeric ${comparison(sql, condition.op)} ${value})`;
  }
  return sql`(jsonb_typeof(properties -> ${key}) = 'string' and properties ->> ${key} ${comparison(sql, condition.op)} ${value as string})`;
};

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const queryOrder = (
  sql: Sql,
  order: QueryOrder,
): { readonly by: Fragment; readonly afterCursor: CursorPredicate } =>
  order === "created_at_desc"
    ? {
        by: sql`created_at desc, id desc`,
        afterCursor: (cursor) =>
          sql`(created_at, id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      }
    : {
        by: sql`created_at asc, id asc`,
        afterCursor: (cursor) =>
          sql`(created_at, id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      };

export const makePostgresMetadataStore = (sql: Sql): MetadataStoreService => ({
  insert: (item) =>
    attempt(async () => {
      await sql`
        insert into items (
          id, tenant_id, name, content_type, declared_size, size, etag,
          checksum, source, status, storage_key, staging_key, created_at,
          updated_at, properties
        ) values (
          ${item.id}, ${item.tenantId}, ${item.name}, ${item.contentType},
          ${item.declaredSize}, ${item.size}, ${item.etag}, ${item.checksum},
          ${item.source}, ${item.status}, ${item.storageKey},
          ${item.stagingKey}, ${item.createdAt}, ${item.updatedAt},
          ${sql.json(item.properties)}
        )
      `;
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
  patch: (tenantId, id, patch, updatedAt) =>
    attempt(async () => {
      return sql.begin(async (transaction) => {
        const rows = await transaction<ItemRow[]>`
          select * from items
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          for update
        `;
        const row = rows[0];
        if (!row) return null;
        const properties = { ...row.properties, ...patch.set };
        for (const key of patch.unset) delete properties[key];
        // `updated_at` is always present, so `sql(values)` is never empty and
        // the inline `properties` clause always has a valid leading comma.
        const values: Record<string, unknown> = { updated_at: updatedAt };
        for (const [key, value] of Object.entries(patch.fields)) {
          const field = FIELD_BY_KEY.get(key);
          if (field) values[field.column] = value;
        }
        const updated = await transaction<ItemRow[]>`
          update items
          set ${transaction(values)}, properties = ${transaction.json(properties)}
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          returning *
        `;
        return updated[0] ? mapRow(updated[0]) : null;
      });
    }),
  remove: (tenantId, id, expectedStatus) =>
    attempt(async () => {
      const rows = await sql`
        delete from items
        where tenant_id = ${tenantId} and id = ${id} and status = ${expectedStatus}
        returning id
      `;
      return rows.length === 1;
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
        const cursor = yield* decodeCursor(query.cursor);
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
      return {
        items,
        ...(rows.length > query.limit && items.at(-1)
          ? { nextCursor: encodeCursor(items.at(-1)!) }
          : {}),
      };
    }),
  usage: (tenantId) =>
    attempt(async () => {
      // One grouped aggregate over the tenant's ready items. count/sum come back
      // as strings from postgres.js (bigint), so cast like mapRow does. Ordering
      // matches the memory store so store-equivalence stays exact.
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
      return { itemCount, totalBytes, byType };
    }),
  sourceUsage: (tenantId, source) =>
    attempt(async () => {
      // Served by items_tenant_source_idx. count/sum arrive as bigint strings
      // from postgres.js; cast like usage does.
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
      // Only scalar values can seed a single-line input; arrays/objects/nulls
      // are filtered out by jsonb_typeof. The driver parses jsonb back to JS
      // scalars, so `value` is already a string/number/boolean.
      const rows = await sql<{ value: PropertyScalar }[]>`
        select distinct properties -> ${key} as value
        from items
        where tenant_id = ${tenantId} and status = 'ready'
          and jsonb_typeof(properties -> ${key}) in ('string', 'number', 'boolean')
        order by value
        limit ${SUGGESTION_VALUE_LIMIT}
      `;
      return rows.map((row) => row.value);
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
