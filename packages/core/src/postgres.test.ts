import type { Principal } from "@keva/schema";
import { Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine, reapPending } from "./engine.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { S3BlobStoreLive } from "./s3.js";
import { BlobStore, MetadataStore } from "./services.js";
import { testSql } from "./test/db.js";
import { putObject, s3MockConfig, startS3Mock, type S3Mock } from "./test/s3-mock.js";

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

describe("Postgres metadata store", () => {
  const sql = testSql(4);
  let mock: S3Mock;
  let layer: Layer.Layer<BlobStore | MetadataStore>;

  beforeAll(async () => {
    mock = await startS3Mock();
    layer = Layer.merge(
      Layer.succeed(MetadataStore, makePostgresMetadataStore(sql)),
      S3BlobStoreLive(s3MockConfig(mock)),
    );
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await mock.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  const stage = (key: string, bytes: Uint8Array, contentType: string) =>
    Effect.promise(() => putObject(mock, key, bytes, contentType));

  const createReady = (p: Principal, name: string, body: string) =>
    Effect.gen(function* () {
      const engine = makeKevaEngine(p);
      const bytes = new TextEncoder().encode(body);
      const initiated = yield* engine.initiate({
        name,
        contentType: "text/plain",
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      yield* stage(initiated.item.stagingKey, bytes, "text/plain");
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  const createReadyWithType = (p: Principal, name: string, contentType: string, body: string) =>
    Effect.gen(function* () {
      const engine = makeKevaEngine(p);
      const bytes = new TextEncoder().encode(body);
      const initiated = yield* engine.initiate({
        name,
        contentType,
        size: bytes.byteLength,
        source: "upload",
        properties: {},
      });
      yield* stage(initiated.item.stagingKey, bytes, contentType);
      yield* engine.confirm(initiated.item.id);
      return initiated.item.id;
    });

  it("applies the checked-in migration indexes", async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = current_schema()
        and indexname in (
          'items_properties_gin_idx',
          'items_tenant_status_created_idx',
          'items_tenant_created_id_idx',
          'items_ready_name_trgm_idx',
          'items_ready_content_type_trgm_idx',
          'item_property_terms_tenant_item_idx',
          'item_property_terms_tenant_key_idx',
          'item_property_terms_tenant_key_value_idx',
          'item_property_terms_key_trgm_idx',
          'item_property_terms_value_trgm_idx',
          'item_property_terms_null_unique',
          'item_property_terms_value_unique',
          'api_tokens_tenant_created_idx'
        )
    `;
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(byName.get("items_properties_gin_idx")).toContain("USING gin");
    expect(byName.has("items_tenant_status_created_idx")).toBe(true);
    expect(byName.has("items_tenant_created_id_idx")).toBe(true);
    for (const indexName of ["items_ready_name_trgm_idx", "items_ready_content_type_trgm_idx"]) {
      const indexDefinition = byName.get(indexName);
      expect(indexDefinition).toBeDefined();
      expect(indexDefinition).toContain("USING gin");
      expect(indexDefinition).toContain("gin_trgm_ops");
      expect(indexDefinition).toMatch(/WHERE .*status.*= 'ready'/);
    }
    for (const indexName of [
      "item_property_terms_tenant_item_idx",
      "item_property_terms_tenant_key_idx",
      "item_property_terms_null_unique",
      "item_property_terms_value_unique",
    ]) {
      expect(byName.has(indexName)).toBe(true);
    }
    const tenantKeyValueIndex = byName.get("item_property_terms_tenant_key_value_idx");
    expect(tenantKeyValueIndex).toContain("USING btree (tenant_id, key, value)");
    expect(tenantKeyValueIndex).toMatch(/WHERE .*value.*IS NOT NULL/i);
    for (const indexName of [
      "item_property_terms_key_trgm_idx",
      "item_property_terms_value_trgm_idx",
    ]) {
      const indexDefinition = byName.get(indexName);
      expect(indexDefinition).toContain("USING gin");
      expect(indexDefinition).toContain("gin_trgm_ops");
    }
    expect(byName.get("item_property_terms_value_trgm_idx")).toMatch(/WHERE .*value.*IS NOT NULL/i);
    expect(byName.has("api_tokens_tenant_created_idx")).toBe(true);
  });

  it("normalizes legacy property values before projection backfill", async () => {
    const tenant = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const migration = await readFile(
      new URL("../drizzle/0012_late_mandroid.sql", import.meta.url),
      "utf8",
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    const validation = statements.find((statement) =>
      statement.includes("Unsupported legacy property shape"),
    );
    const normalization = statements.find((statement) =>
      statement.startsWith("WITH property_values AS"),
    );
    const backfill = statements.find((statement) => statement.startsWith("WITH expanded AS"));
    if (!validation || !normalization || !backfill) {
      throw new Error("Migration normalization statements are missing");
    }

    const properties = await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = replica`;
      await transaction`
        insert into items (
          id, tenant_id, name, content_type, declared_size, source, status,
          storage_key, staging_key, created_at, updated_at, properties
        ) values (
          ${itemId}, ${tenant}, 'legacy-properties.txt', 'text/plain', 1, 'upload', 'ready',
          ${`items/${tenant}/${itemId}`}, ${`staging/${tenant}/${itemId}`},
          ${timestamp}, ${timestamp},
          ${JSON.stringify({
            empty: [],
            emptyScalar: "",
            mixed: [1, "1", true, "true", 2, false, 2],
            onlyEmptyMembers: ["", ""],
            scalarBoolean: false,
            scalarNumber: 42,
            tag: null,
            text: "kept",
            withEmptyMembers: ["", 3, "", "kept", 3, ""],
          })}::text::jsonb
        )
      `;
      await transaction.unsafe(validation);
      await transaction.unsafe(normalization);
      await transaction.unsafe(backfill);
      const rows = await transaction<{ properties: Record<string, unknown> }[]>`
        select properties from items where tenant_id = ${tenant} and id = ${itemId}
      `;
      return rows[0]!.properties;
    });

    for (const unsupported of [
      { object: { nested: true } },
      { nestedArray: [["nested"]] },
      { nullMember: [null] },
    ]) {
      const invalidId = crypto.randomUUID();
      await expect(
        sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`
            insert into items (
              id, tenant_id, name, content_type, declared_size, source, status,
              storage_key, staging_key, created_at, updated_at, properties
            ) values (
              ${invalidId}, ${tenant}, 'invalid-legacy-properties.txt', 'text/plain', 1,
              'upload', 'ready', ${`items/${tenant}/${invalidId}`},
              ${`staging/${tenant}/${invalidId}`}, ${timestamp}, ${timestamp},
              ${JSON.stringify(unsupported)}::text::jsonb
            )
          `;
          await transaction.unsafe(validation);
        }),
      ).rejects.toMatchObject({ code: "P0001" });
    }

    expect(properties).toEqual({
      mixed: ["1", "true", "2", "false"],
      scalarBoolean: "false",
      scalarNumber: "42",
      tag: null,
      text: "kept",
      withEmptyMembers: ["3", "kept"],
    });
    const engine = makeKevaEngine(principal(tenant));
    const discovery = await run(
      Effect.all({
        keys: engine.propertyKeys(),
        mixed: engine.propertyValues("mixed"),
        summary: engine.propertySummary(),
        withEmptyMembers: engine.propertyValues("withEmptyMembers"),
        suggestions: engine.propertySuggestions("true", 10),
      }),
    );
    expect(discovery.keys).toEqual({
      keys: ["mixed", "scalarBoolean", "scalarNumber", "tag", "text", "withEmptyMembers"],
    });
    expect(discovery.mixed).toEqual({ values: ["1", "2", "false", "true"] });
    expect(discovery.withEmptyMembers).toEqual({ values: ["3", "kept"] });
    expect(discovery.summary).toEqual({
      entries: [
        { key: "mixed", kinds: ["array"], values: ["1", "2", "false", "true"] },
        { key: "scalarBoolean", kinds: ["string"], values: ["false"] },
        { key: "scalarNumber", kinds: ["string"], values: ["42"] },
        { key: "tag", kinds: ["tag"], values: [] },
        { key: "text", kinds: ["string"], values: ["kept"] },
        { key: "withEmptyMembers", kinds: ["array"], values: ["3", "kept"] },
      ],
    });
    expect(discovery.suggestions).toEqual({
      entries: [{ key: "mixed", value: "true" }],
    });
  });

  it("persists items + properties across a new store instance", async () => {
    const tenant = crypto.randomUUID();
    const p = principal(tenant);

    const id = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const created = yield* createReady(p, "persist.txt", "durable bytes");
        yield* engine.patch(created, { set: { project: "keva", rating: "nine" }, unset: [] });
        return created;
      }),
    );

    const fresh = makePostgresMetadataStore(sql);
    const fetched = await Effect.runPromise(
      makeKevaEngine(p)
        .get(id)
        .pipe(
          Effect.provide(
            Layer.merge(Layer.succeed(MetadataStore, fresh), S3BlobStoreLive(s3MockConfig(mock))),
          ),
        ),
    );
    expect(fetched.status).toBe("ready");
    expect(fetched.properties).toEqual({ project: "keva", rating: "nine" });
  });

  it("maintains property terms across direct writes and metadata mutations", async () => {
    const tenant = crypto.randomUUID();
    const otherTenant = crypto.randomUUID();
    const directId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const cascadeId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    type Term = { key: string; kind: "tag" | "string" | "array"; value: string | null };
    const termsFor = (itemId: string) => sql<Term[]>`
      select key, kind, value
      from item_property_terms
      where tenant_id = ${tenant} and item_id = ${itemId}
      order by key, kind, value nulls first
    `;

    const consistency = await run(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          sql`
            insert into items (
              id, tenant_id, name, content_type, declared_size, source, status,
              storage_key, staging_key, created_at, updated_at, properties
            ) values (
              ${directId}, ${tenant}, 'direct-ready.txt', 'text/plain', 1, 'upload', 'ready',
              ${`items/${tenant}/${directId}`}, ${`staging/${tenant}/${directId}`},
              ${timestamp}, ${timestamp},
              ${JSON.stringify({ arrayKey: ["a", "b"], stringKey: "value", tagKey: null })}::text::jsonb
            )
          `.then(() => undefined),
        );
        const directTerms = yield* Effect.promise(() => termsFor(directId));

        yield* Effect.promise(() =>
          sql`
            insert into items (
              id, tenant_id, name, content_type, declared_size, source, status,
              storage_key, staging_key, created_at, updated_at, properties
            ) values (
              ${pendingId}, ${tenant}, 'direct-pending.txt', 'text/plain', 1, 'upload', 'pending',
              ${`items/${tenant}/${pendingId}`}, ${`staging/${tenant}/${pendingId}`},
              ${timestamp}, ${timestamp}, ${JSON.stringify({ pendingKey: "pending-value" })}::text::jsonb
            )
          `.then(() => undefined),
        );
        const pendingBefore = yield* Effect.promise(() => termsFor(pendingId));
        const metadata = yield* MetadataStore;
        yield* metadata.transition(tenant, pendingId, ["pending"], {
          status: "ready",
          updatedAt: timestamp,
        });
        const pendingReady = yield* Effect.promise(() => termsFor(pendingId));

        yield* metadata.transition(tenant, directId, ["ready"], {
          status: "deleting",
          updatedAt: timestamp,
        });
        const transitionRemoved = yield* Effect.promise(() => termsFor(directId));

        const p = principal(tenant);
        const eventTransitionId = yield* createReady(p, "event-transition.txt", "e");
        yield* makeKevaEngine(p).patch(eventTransitionId, {
          set: { eventTransitionKey: "event-transition-value" },
          unset: [],
        });
        yield* metadata.transitionWithEvent(
          tenant,
          eventTransitionId,
          ["ready"],
          { status: "deleting", updatedAt: timestamp },
          (item) => ({
            id: crypto.randomUUID(),
            tenantId: tenant,
            itemId: item.id,
            itemName: item.name,
            action: "deleted",
            actor: null,
            payload: {},
            createdAt: timestamp,
          }),
        );
        const eventTransitionRemoved = yield* Effect.promise(() => termsFor(eventTransitionId));

        const patchedId = yield* createReady(p, "patched-terms.txt", "p");
        yield* metadata.patch(
          tenant,
          patchedId,
          { fields: {}, set: { plainKey: "before", removedKey: "gone" }, unset: [] },
          timestamp,
        );
        const patched = yield* Effect.promise(() => termsFor(patchedId));
        yield* makeKevaEngine(p).patch(patchedId, {
          set: { eventKey: ["after", "next"] },
          unset: ["plainKey", "removedKey"],
        });
        const patchedWithEvent = yield* Effect.promise(() => termsFor(patchedId));

        yield* Effect.promise(() =>
          sql`
            insert into items (
              id, tenant_id, name, content_type, declared_size, source, status,
              storage_key, staging_key, created_at, updated_at, properties
            ) values (
              ${cascadeId}, ${tenant}, 'cascade-ready.txt', 'text/plain', 1, 'upload', 'ready',
              ${`items/${tenant}/${cascadeId}`}, ${`staging/${tenant}/${cascadeId}`},
              ${timestamp}, ${timestamp}, ${JSON.stringify({ cascadeKey: "cascade-value" })}::text::jsonb
            )
          `.then(() => undefined),
        );
        const cascadeBefore = yield* Effect.promise(() => termsFor(cascadeId));
        yield* Effect.promise(() =>
          sql`delete from items where tenant_id = ${tenant} and id = ${cascadeId}`.then(
            () => undefined,
          ),
        );
        const cascadeAfter = yield* Effect.promise(() => termsFor(cascadeId));

        const crossTenantCode = yield* Effect.promise(async () => {
          try {
            await sql`
              insert into item_property_terms (tenant_id, item_id, key, kind, value)
              values (${otherTenant}, ${pendingId}, 'invalid', 'string', 'invalid')
            `;
            return null;
          } catch (error) {
            return (error as { code?: string }).code ?? null;
          }
        });

        return {
          directTerms,
          pendingBefore,
          pendingReady,
          transitionRemoved,
          eventTransitionRemoved,
          patched,
          patchedWithEvent,
          cascadeBefore,
          cascadeAfter,
          crossTenantCode,
        };
      }),
    );

    expect(consistency.directTerms).toEqual([
      { key: "arrayKey", kind: "array", value: "a" },
      { key: "arrayKey", kind: "array", value: "b" },
      { key: "stringKey", kind: "string", value: "value" },
      { key: "tagKey", kind: "tag", value: null },
    ]);
    expect(consistency.pendingBefore).toEqual([]);
    expect(consistency.pendingReady).toEqual([
      { key: "pendingKey", kind: "string", value: "pending-value" },
    ]);
    expect(consistency.transitionRemoved).toEqual([]);
    expect(consistency.eventTransitionRemoved).toEqual([]);
    expect(consistency.patched).toEqual([
      { key: "plainKey", kind: "string", value: "before" },
      { key: "removedKey", kind: "string", value: "gone" },
    ]);
    expect(consistency.patchedWithEvent).toEqual([
      { key: "eventKey", kind: "array", value: "after" },
      { key: "eventKey", kind: "array", value: "next" },
    ]);
    expect(consistency.cascadeBefore).toEqual([
      { key: "cascadeKey", kind: "string", value: "cascade-value" },
    ]);
    expect(consistency.cascadeAfter).toEqual([]);
    expect(consistency.crossTenantCode).toBe("23503");
  });

  it("searches configured text fields with tenant-scoped pagination", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const found = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(principal(tenantA));
        const named = yield* createReady(principal(tenantA), "quarterly-fox.txt", "a");
        const typed = yield* createReadyWithType(
          principal(tenantA),
          "diagram.svg",
          "image/fox-icon",
          "b",
        );
        const literal = yield* createReady(principal(tenantA), "literal-%_\\-markers.txt", "c");
        yield* createReady(principal(tenantA), "plain.txt", "d");
        yield* createReady(principal(tenantB), "other-fox.txt", "e");
        yield* createReady(principal(tenantB), "literal-%_\\-markers.txt", "f");
        const all = yield* engine.query({
          where: [],
          search: "FOX",
          limit: 100,
          order: "created_at_asc",
        });
        const first = yield* engine.query({
          where: [],
          search: "fox",
          limit: 1,
          order: "created_at_asc",
        });
        const namesOnly = yield* engine.query({
          where: [],
          search: "FOX",
          searchFields: ["name"],
          limit: 100,
          order: "created_at_asc",
        });
        const contentTypesOnly = yield* engine.query({
          where: [],
          search: "FOX",
          searchFields: ["content_type"],
          limit: 100,
          order: "created_at_asc",
        });
        const literalPercent = yield* engine.query({
          where: [],
          search: "%",
          searchFields: ["name"],
          limit: 100,
          order: "created_at_asc",
        });
        const literalUnderscore = yield* engine.query({
          where: [],
          search: "_",
          searchFields: ["name"],
          limit: 100,
          order: "created_at_asc",
        });
        const literalBackslash = yield* engine.query({
          where: [],
          search: "\\",
          searchFields: ["name"],
          limit: 100,
          order: "created_at_asc",
        });
        const other = yield* makeKevaEngine(principal(tenantB)).query({
          where: [],
          search: "quarterly",
          limit: 100,
          order: "created_at_asc",
        });
        return {
          named,
          typed,
          literal,
          all,
          first,
          namesOnly,
          contentTypesOnly,
          literalPercent,
          literalUnderscore,
          literalBackslash,
          other,
        };
      }),
    );

    expect(found.all.items.map((item) => item.id).sort()).toEqual(
      [found.named, found.typed].sort(),
    );
    expect(found.first.items).toHaveLength(1);
    expect(found.first.nextCursor).toBeDefined();
    expect(found.namesOnly.items.map((item) => item.id)).toEqual([found.named]);
    expect(found.contentTypesOnly.items.map((item) => item.id)).toEqual([found.typed]);
    expect(found.literalPercent.items.map((item) => item.id)).toEqual([found.literal]);
    expect(found.literalUnderscore.items.map((item) => item.id)).toEqual([found.literal]);
    expect(found.literalBackslash.items.map((item) => item.id)).toEqual([found.literal]);
    expect(found.typed).not.toBe(found.named);
    expect(found.other.items).toHaveLength(0);
  });

  it("discovers ready tenant property shapes and tracks updates", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const discovery = await run(
      Effect.gen(function* () {
        const p = principal(tenantA);
        const engine = makeKevaEngine(p);
        const one = yield* createReady(p, "properties-one.txt", "a");
        const two = yield* createReady(p, "properties-two.txt", "b");
        const removed = yield* createReady(p, "properties-removed.txt", "c");
        yield* engine.patch(one, {
          set: {
            arrayKey: ["alpha", "beta"],
            oldKey: "old",
            shared: "same",
            stringKey: "one",
            tagKey: null,
          },
          unset: [],
        });
        yield* engine.patch(two, {
          set: { arrayKey: ["beta", "gamma"], shared: "same" },
          unset: [],
        });
        yield* engine.patch(one, {
          set: { stringKey: "two", updatedKey: "updated" },
          unset: ["oldKey"],
        });
        yield* engine.patch(removed, { set: { removedKey: "gone" }, unset: [] });
        const pending = yield* engine.initiate({
          name: "properties-pending.txt",
          contentType: "text/plain",
          size: 1,
          source: "upload",
          properties: { pendingKey: "hidden" },
        });
        const other = yield* createReady(principal(tenantB), "properties-other.txt", "d");
        yield* makeKevaEngine(principal(tenantB)).patch(other, {
          set: { tenantKey: "hidden" },
          unset: [],
        });
        const metadata = yield* MetadataStore;
        yield* metadata.transition(tenantA, removed, ["ready"], {
          status: "deleting",
          updatedAt: new Date().toISOString(),
        });
        return {
          pendingStatus: pending.item.status,
          keys: yield* engine.propertyKeys(),
          arrayValues: yield* engine.propertyValues("arrayKey"),
          tagValues: yield* engine.propertyValues("tagKey"),
          summary: yield* engine.propertySummary(),
        };
      }),
    );

    expect(discovery.pendingStatus).toBe("pending");
    expect(discovery.keys).toEqual({
      keys: ["arrayKey", "shared", "stringKey", "tagKey", "updatedKey"],
    });
    expect(discovery.arrayValues).toEqual({ values: ["alpha", "beta", "gamma"] });
    expect(discovery.tagValues).toEqual({ values: [] });
    expect(discovery.summary).toEqual({
      entries: [
        { key: "arrayKey", kinds: ["array"], values: ["alpha", "beta", "gamma"] },
        { key: "shared", kinds: ["string"], values: ["same"] },
        { key: "stringKey", kinds: ["string"], values: ["two"] },
        { key: "tagKey", kinds: ["tag"], values: [] },
        { key: "updatedKey", kinds: ["string"], values: ["updated"] },
      ],
    });
  });

  it("orders, limits, and escapes property suggestions", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const suggestions = await run(
      Effect.gen(function* () {
        const p = principal(tenantA);
        const engine = makeKevaEngine(p);
        const one = yield* createReady(p, "suggestions-one.txt", "a");
        const two = yield* createReady(p, "suggestions-two.txt", "b");
        yield* engine.patch(one, {
          set: {
            backslashLiteral: "literal\\value",
            department: "Finance",
            financeKey: null,
            mode: "fin",
            percentLiteral: "literal%value",
            underscoreLiteral: "literal_value",
            teams: ["FinOps", "Refinance"],
          },
          unset: [],
        });
        yield* engine.patch(two, {
          set: { department: "Finance", teams: ["FinOps"] },
          unset: [],
        });
        yield* engine.initiate({
          name: "suggestions-pending.txt",
          contentType: "text/plain",
          size: 1,
          source: "upload",
          properties: { pendingFinance: "Finance" },
        });
        const other = yield* createReady(principal(tenantB), "suggestions-other.txt", "c");
        yield* makeKevaEngine(principal(tenantB)).patch(other, {
          set: { privateFinance: "Finance" },
          unset: [],
        });
        return {
          all: yield* engine.propertySuggestions("fin", 12),
          limited: yield* engine.propertySuggestions("fin", 3),
          percent: yield* engine.propertySuggestions("%", 12),
          underscore: yield* engine.propertySuggestions("_", 12),
          backslash: yield* engine.propertySuggestions("\\", 12),
        };
      }),
    );

    const ordered = [
      { key: "mode", value: "fin" },
      { key: "department", value: "Finance" },
      { key: "financeKey" },
      { key: "teams", value: "FinOps" },
      { key: "teams", value: "Refinance" },
    ];
    expect(suggestions.all.entries).toEqual(ordered);
    expect(suggestions.limited.entries).toEqual(ordered.slice(0, 3));
    expect(suggestions.percent.entries).toEqual([
      { key: "percentLiteral", value: "literal%value" },
    ]);
    expect(suggestions.underscore.entries).toEqual([
      { key: "underscoreLiteral", value: "literal_value" },
    ]);
    expect(suggestions.backslash.entries).toEqual([
      { key: "backslashLiteral", value: "literal\\value" },
    ]);
  });

  it("returns stable offset pages with an exact tenant-scoped filtered total", async () => {
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();
    const result = await run(
      Effect.gen(function* () {
        const p = principal(tenantA);
        const first = yield* createReady(p, "numbered-1.txt", "a");
        yield* createReady(p, "excluded.txt", "b");
        const second = yield* createReady(p, "numbered-2.txt", "c");
        const third = yield* createReady(p, "numbered-3.txt", "d");
        yield* createReady(principal(tenantB), "numbered-other-tenant.txt", "e");
        yield* Effect.promise(() =>
          sql`
            update items
            set created_at = case id
              when ${first} then '2025-01-01T00:00:01.000Z'::timestamptz
              when ${second} then '2025-01-01T00:00:02.000Z'::timestamptz
              when ${third} then '2025-01-01T00:00:03.000Z'::timestamptz
            end
            where tenant_id = ${tenantA} and id in (${first}, ${second}, ${third})
          `.then(() => undefined),
        );
        const engine = makeKevaEngine(p);
        const middle = yield* engine.query({
          where: [],
          search: "numbered-",
          limit: 1,
          offset: 1,
          order: "created_at_asc",
        });
        const beyondEnd = yield* engine.query({
          where: [],
          search: "numbered-",
          limit: 2,
          offset: 10,
          order: "created_at_asc",
        });
        const descending = yield* engine.query({
          where: [],
          search: "numbered-",
          limit: 3,
          offset: 0,
          order: "created_at_desc",
        });
        return { middle, beyondEnd, descending };
      }),
    );

    expect(result.middle.items.map((item) => item.name)).toEqual(["numbered-2.txt"]);
    expect(result.middle.totalCount).toBe(3);
    expect(result.middle.nextCursor).toBeUndefined();
    expect(result.beyondEnd.items).toEqual([]);
    expect(result.beyondEnd.totalCount).toBe(3);
    expect(result.descending.items.map((item) => item.name)).toEqual([
      "numbered-3.txt",
      "numbered-2.txt",
      "numbered-1.txt",
    ]);
    expect(result.descending.totalCount).toBe(3);
  });

  it("resolves a concurrent confirm-vs-reaper race to exactly one winner", async () => {
    const tenant = crypto.randomUUID();
    const p = principal(tenant);

    const outcome = await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const bytes = new TextEncoder().encode("racing");
        const initiated = yield* engine.initiate({
          name: "race.txt",
          contentType: "text/plain",
          size: bytes.byteLength,
          source: "upload",
          properties: {},
        });
        yield* Effect.promise(() =>
          sql`update items set created_at = now() - interval '1 hour'
              where id = ${initiated.item.id}`.then(() => undefined),
        );
        yield* stage(initiated.item.stagingKey, bytes, "text/plain");

        const [confirmExit, reaped] = yield* Effect.all(
          [Effect.either(engine.confirm(initiated.item.id)), reapPending({ pendingTtlMs: 1 })],
          { concurrency: "unbounded" },
        );

        const metadata = yield* MetadataStore;
        const current = yield* metadata.get(tenant, initiated.item.id);
        return { confirmExit, reaped, status: current?.status ?? "gone" };
      }),
    );

    if (outcome.confirmExit._tag === "Right") {
      expect(outcome.status).toBe("ready");
      expect(outcome.reaped).toEqual({ completed: 0, failed: 0 });
    } else {
      expect(outcome.confirmExit.left._tag).toBe("Conflict");
      expect(outcome.status).toBe("deleting");
      expect(outcome.reaped).toEqual({ completed: 1, failed: 0 });
    }
  });
});
