import {
  Internal,
  ValidationError,
  type AttributeValue,
  type KevaError,
  type KevaObject,
  type QueryCondition,
} from "@keva/schema";
import { Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";
import {
  MetadataStore,
  type MetadataStoreService,
  type ObjectTransition,
} from "../services.js";

export interface PostgresConfig {
  readonly url: string;
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
}

interface ObjectRow {
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
  readonly attributes: KevaObject["attributes"];
}

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRow = (row: ObjectRow): KevaObject => ({
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
  attributes: row.attributes,
});

const dbFailure = (): Internal =>
  new Internal({ message: "Metadata store unavailable" });

const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, KevaError> =>
  Effect.tryPromise({ try: operation, catch: dbFailure });

const encodeCursor = (object: KevaObject): string =>
  btoa(JSON.stringify([object.createdAt, object.id]));

const decodeCursor = (
  cursor: string,
): Effect.Effect<readonly [string, string], ValidationError> =>
  Effect.try({
    try: () => {
      const value = JSON.parse(atob(cursor)) as unknown;
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof value[0] !== "string" ||
        typeof value[1] !== "string"
      ) throw new Error("invalid cursor");
      return [value[0], value[1]] as const;
    },
    catch: () => new ValidationError({ message: "Invalid query cursor" }),
  });

type Fragment = ReturnType<Sql["unsafe"]>;

const systemColumn = (
  sql: Sql,
  key: string,
): {
  fragment: Fragment;
  type: "string" | "number" | "nullable-string" | "timestamp";
} | null => {
  switch (key) {
    case "id":
      return { fragment: sql.unsafe("id"), type: "string" };
    case "name":
      return { fragment: sql.unsafe("name"), type: "string" };
    case "system.content_type":
      return { fragment: sql.unsafe("content_type"), type: "string" };
    case "system.size":
      return { fragment: sql.unsafe("size"), type: "number" };
    case "system.etag":
      return { fragment: sql.unsafe("etag"), type: "nullable-string" };
    case "system.checksum":
      return { fragment: sql.unsafe("checksum"), type: "nullable-string" };
    case "system.source":
      return { fragment: sql.unsafe("source"), type: "string" };
    case "system.status":
      return { fragment: sql.unsafe("status"), type: "string" };
    case "system.created_at":
      return { fragment: sql.unsafe("created_at"), type: "timestamp" };
    case "system.updated_at":
      return { fragment: sql.unsafe("updated_at"), type: "timestamp" };
    default:
      return null;
  }
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

const compileCondition = (
  sql: Sql,
  condition: QueryCondition,
): Fragment => {
  const column = systemColumn(sql, condition.key);
  const value = condition.value;
  if (column) {
    if (condition.op === "exists") return sql`true`;
    const expected = column.type === "number" ? "number" : "string";
    if (value !== null && typeof value !== expected) return sql`false`;
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
  if (condition.op === "exists") return sql`attributes ? ${key}`;
  if (condition.op === "eq") {
    return sql`attributes @> ${sql.json({ [key]: value })}`;
  }
  if (condition.op === "neq") {
    return sql`attributes ? ${key} and not (attributes @> ${sql.json({ [key]: value })})`;
  }
  if (condition.op === "contains") {
    const member = value as string | number | boolean;
    const arrayMatch =
      sql`(jsonb_typeof(attributes -> ${key}) = 'array' and (attributes -> ${key}) @> ${sql.json([member])})`;
    return typeof value === "string"
      ? sql`(${arrayMatch} or (jsonb_typeof(attributes -> ${key}) = 'string' and position(${value} in attributes ->> ${key}) > 0))`
      : arrayMatch;
  }
  if (typeof value === "number") {
    return sql`(jsonb_typeof(attributes -> ${key}) = 'number' and (attributes ->> ${key})::numeric ${comparison(sql, condition.op)} ${value})`;
  }
  return sql`(jsonb_typeof(attributes -> ${key}) = 'string' and attributes ->> ${key} ${comparison(sql, condition.op)} ${value as string})`;
};

const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export const makePostgresMetadataStore = (
  sql: Sql,
): MetadataStoreService => ({
  insert: (object) =>
    attempt(async () => {
      await sql`
        insert into objects (
          id, tenant_id, name, content_type, declared_size, size, etag,
          checksum, source, status, storage_key, staging_key, created_at,
          updated_at, attributes
        ) values (
          ${object.id}, ${object.tenantId}, ${object.name}, ${object.contentType},
          ${object.declaredSize}, ${object.size}, ${object.etag}, ${object.checksum},
          ${object.source}, ${object.status}, ${object.storageKey},
          ${object.stagingKey}, ${object.createdAt}, ${object.updatedAt},
          ${sql.json(object.attributes)}
        )
      `;
    }),
  get: (tenantId, id) =>
    attempt(async () => {
      const rows = await sql<ObjectRow[]>`
        select * from objects where tenant_id = ${tenantId} and id = ${id} limit 1
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
      const rows = olderThan === undefined
        ? await sql`
            update objects set ${sql(values)}
            where tenant_id = ${tenantId} and id = ${id}
              and status in ${sql(from)}
            returning id
          `
        : await sql`
            update objects set ${sql(values)}
            where tenant_id = ${tenantId} and id = ${id}
              and status in ${sql(from)} and created_at < ${olderThan}
            returning id
          `;
      return rows.length === 1;
    }),
  patchAttributes: (tenantId, id, patch, updatedAt) =>
    attempt(async () => {
      return sql.begin(async (transaction) => {
        const rows = await transaction<ObjectRow[]>`
          select * from objects
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          for update
        `;
        const row = rows[0];
        if (!row) return null;
        const attributes = { ...row.attributes, ...patch.set };
        for (const key of patch.unset) delete attributes[key];
        const updated = await transaction<ObjectRow[]>`
          update objects
          set attributes = ${transaction.json(attributes)}, updated_at = ${updatedAt}
          where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
          returning *
        `;
        return updated[0] ? mapRow(updated[0]) : null;
      });
    }),
  remove: (tenantId, id, expectedStatus) =>
    attempt(async () => {
      const rows = await sql`
        delete from objects
        where tenant_id = ${tenantId} and id = ${id} and status = ${expectedStatus}
        returning id
      `;
      return rows.length === 1;
    }),
  query: (tenantId, query) =>
    Effect.gen(function* () {
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
        predicates.push(
          sql`(created_at, id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
        );
      }
      const where = predicates.reduce((left, right) => sql`${left} and ${right}`);
      const rows = yield* attempt(() =>
        sql<ObjectRow[]>`
          select * from objects
          where ${where}
          order by created_at asc, id asc
          limit ${query.limit + 1}
        `
      );
      const objects = rows.slice(0, query.limit).map(mapRow);
      return {
        objects,
        ...(rows.length > query.limit && objects.at(-1)
          ? { nextCursor: encodeCursor(objects.at(-1)!) }
          : {}),
      };
    }),
  listByStatus: (status, limit, olderThan) =>
    attempt(async () => {
      const rows = olderThan === undefined
        ? await sql<ObjectRow[]>`
            select * from objects where status = ${status}
            order by created_at asc limit ${limit}
          `
        : await sql<ObjectRow[]>`
            select * from objects
            where status = ${status} and created_at < ${olderThan}
            order by created_at asc limit ${limit}
          `;
      return rows.map(mapRow);
    }),
});

export const PostgresMetadataStoreLive = (
  config: PostgresConfig,
): Layer.Layer<MetadataStore> =>
  Layer.scoped(
    MetadataStore,
    Effect.acquireRelease(
      Effect.sync(() =>
        postgres(config.url, {
          max: config.maxConnections ?? 10,
          idle_timeout: config.idleTimeoutSeconds ?? 20,
          connect_timeout: config.connectTimeoutSeconds ?? 10,
        })
      ),
      (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
    ).pipe(Effect.map(makePostgresMetadataStore)),
  );
