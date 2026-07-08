import {
  StorageUnavailable,
  type CreateView,
  type QueryCondition,
  type UpdateView,
  type ViewRecord,
} from "@keva/schema";
import { Context, Effect, Layer } from "effect";
import postgres, { type Sql } from "postgres";
import { randomTokenPart } from "./auth.js";

// A view is a named, saved filter owned by a tenant — the owner's first-class
// navigation object, and the thing a share grant references for its conditions.
export interface ViewStoreService {
  readonly create: (
    tenantId: string,
    input: CreateView,
  ) => Effect.Effect<ViewRecord, StorageUnavailable>;
  readonly list: (tenantId: string) => Effect.Effect<ReadonlyArray<ViewRecord>, StorageUnavailable>;
  readonly get: (
    tenantId: string,
    id: string,
  ) => Effect.Effect<ViewRecord | null, StorageUnavailable>;
  readonly update: (
    tenantId: string,
    id: string,
    input: UpdateView,
  ) => Effect.Effect<ViewRecord | null, StorageUnavailable>;
  readonly delete: (tenantId: string, id: string) => Effect.Effect<boolean, StorageUnavailable>;
}

export class ViewStore extends Context.Tag("@keva/server/ViewStore")<
  ViewStore,
  ViewStoreService
>() {}

interface ViewRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly conditions: ReadonlyArray<QueryCondition>;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const viewRecord = (row: ViewRow): ViewRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  icon: row.icon,
  conditions: [...row.conditions],
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const storageError = (): StorageUnavailable =>
  new StorageUnavailable({ message: "View storage unavailable" });

export const makePostgresViewStore = (sql: Sql): ViewStoreService => ({
  create: (tenantId, input) =>
    Effect.tryPromise({
      try: async () => {
        const id = randomTokenPart(12);
        const rows = await sql<ViewRow[]>`
          insert into views (id, tenant_id, name, icon, conditions, created_at, updated_at)
          values (${id}, ${tenantId}, ${input.name}, ${input.icon ?? null}, ${sql.json(input.conditions)}, now(), now())
          returning *
        `;
        return viewRecord(rows[0]!);
      },
      catch: storageError,
    }),
  list: (tenantId) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<ViewRow[]>`
          select * from views
          where tenant_id = ${tenantId}
          order by created_at desc
        `;
        return rows.map(viewRecord);
      },
      catch: storageError,
    }),
  get: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<ViewRow[]>`
          select * from views
          where tenant_id = ${tenantId} and id = ${id}
          limit 1
        `;
        return rows[0] ? viewRecord(rows[0]) : null;
      },
      catch: storageError,
    }),
  // COALESCE keeps each column untouched when its patch field is omitted (bound
  // as null); casts give postgres the type it needs to resolve the coalesce.
  update: (tenantId, id, input) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql<ViewRow[]>`
          update views set
            name = coalesce(${input.name ?? null}::text, name),
            icon = coalesce(${input.icon ?? null}::text, icon),
            conditions = coalesce(${input.conditions ? sql.json(input.conditions) : null}::jsonb, conditions),
            updated_at = now()
          where tenant_id = ${tenantId} and id = ${id}
          returning *
        `;
        return rows[0] ? viewRecord(rows[0]) : null;
      },
      catch: storageError,
    }),
  delete: (tenantId, id) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await sql`
          delete from views
          where tenant_id = ${tenantId} and id = ${id}
          returning id
        `;
        return rows.length === 1;
      },
      catch: storageError,
    }),
});

export const PostgresViewStoreLive = (url: string): Layer.Layer<ViewStore> =>
  Layer.scoped(
    ViewStore,
    Effect.acquireRelease(
      Effect.sync(() => postgres(url)),
      (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
    ).pipe(Effect.map(makePostgresViewStore)),
  );

// No Postgres means view management is unreachable (it requires an admin
// session, which needs a DB); every op surfaces a typed StorageUnavailable
// rather than an untyped defect. Mirrors unavailableShareStore.
const viewsNeedDatabase = () =>
  Effect.fail(new StorageUnavailable({ message: "Views require a database" }));

export const unavailableViewStore: ViewStoreService = {
  create: viewsNeedDatabase,
  list: viewsNeedDatabase,
  get: viewsNeedDatabase,
  update: viewsNeedDatabase,
  delete: viewsNeedDatabase,
};
