import type { Principal, Query } from "@keva/schema";
import { Effect, Layer } from "effect";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine } from "./engine.js";
import { makeMemoryMetadataStore, MemoryBlobStoreLive } from "./memory.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import {
  BlobStore,
  MetadataStore,
  type MetadataStoreService,
} from "./services.js";

const DATABASE_URL = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.KEVA_TEST_DATABASE_URL;

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

const SEED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  [
    "alpha",
    "text/plain",
    { kind: "doc", rating: 5, tags: ["x", "y"], note: "hello world" },
  ],
  [
    "bravo",
    "image/png",
    { kind: "image", rating: 10, tags: ["y", "z"] },
  ],
  ["carol", "application/pdf", { kind: "doc", rating: 1, label: null }],
];

const QUERIES: Record<string, Query> = {
  eqString: { where: [{ key: "kind", op: "eq", value: "doc" }], limit: 100 },
  neqString: { where: [{ key: "kind", op: "neq", value: "image" }], limit: 100 },
  arrayMember: {
    where: [{ key: "tags", op: "contains", value: "y" }],
    limit: 100,
  },
  substring: {
    where: [{ key: "note", op: "contains", value: "world" }],
    limit: 100,
  },
  rangeNumber: { where: [{ key: "rating", op: "gte", value: 5 }], limit: 100 },
  existsKey: { where: [{ key: "label", op: "exists" }], limit: 100 },
  eqNull: { where: [{ key: "label", op: "eq", value: null }], limit: 100 },
  neqPropTypeMismatch: {
    where: [{ key: "rating", op: "neq", value: "5" }],
    limit: 100,
  },
  sysContentTypeEq: {
    where: [{ key: "system.content_type", op: "eq", value: "image/png" }],
    limit: 100,
  },
  sysContentTypeNeq: {
    where: [{ key: "system.content_type", op: "neq", value: "image/png" }],
    limit: 100,
  },
  sysSizeNeqTypeMismatch: {
    where: [{ key: "system.size", op: "neq", value: "x" }],
    limit: 100,
  },
};

const EXPECTED: Record<string, string[]> = {
  eqString: ["alpha", "carol"],
  neqString: ["alpha", "carol"],
  arrayMember: ["alpha", "bravo"],
  substring: ["alpha"],
  rangeNumber: ["alpha", "bravo"],
  existsKey: ["carol"],
  eqNull: ["carol"],
  neqPropTypeMismatch: ["alpha", "bravo", "carol"],
  sysContentTypeEq: ["bravo"],
  sysContentTypeNeq: ["alpha", "carol"],
  sysSizeNeqTypeMismatch: ["alpha", "bravo", "carol"],
};

const migrationDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

const applyMigrations = async (sql: Sql): Promise<void> => {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const migration = await readFile(resolve(migrationDir, file), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
  }
};

const seedAndRun = async (
  store: MetadataStoreService,
): Promise<Record<string, string[]>> => {
  const tenant = crypto.randomUUID();
  const p = principal(tenant);
  const layer = Layer.merge(
    Layer.succeed(MetadataStore, store),
    MemoryBlobStoreLive(),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

  for (const [name, contentType, properties] of SEED) {
    await run(
      Effect.gen(function* () {
        const engine = makeKevaEngine(p);
        const bytes = new TextEncoder().encode(name);
        const initiated = yield* engine.initiate({
          name,
          contentType,
          size: bytes.byteLength,
          source: "upload",
          properties: {},
        });
        const token = new URL(initiated.uploadUrl).searchParams.get("token")!;
        const blobs = yield* BlobStore;
        yield* blobs.devPut!(initiated.item.stagingKey, bytes, contentType, token);
        yield* engine.confirm(initiated.item.id);
        yield* engine.patch(initiated.item.id, {
          set: properties as Record<string, never>,
          unset: [],
        });
      }),
    );
  }

  const results: Record<string, string[]> = {};
  for (const [label, query] of Object.entries(QUERIES)) {
    const res = await run(makeKevaEngine(p).query(query));
    results[label] = res.items.map((item) => item.name).sort();
  }
  return results;
};

describe("store query equivalence", () => {
  it("the in-memory store matches the specified semantics", async () => {
    const got = await seedAndRun(makeMemoryMetadataStore());
    expect(got).toEqual(EXPECTED);
  });

  describe.skipIf(!DATABASE_URL)("postgres equals memory", () => {
    let sql: Sql;

    beforeAll(async () => {
      sql = postgres(DATABASE_URL!, { max: 4 });
      await applyMigrations(sql);
    });

    afterAll(async () => {
      await sql.end({ timeout: 5 });
    });

    it("returns identical results for every query in the battery", async () => {
      const memory = await seedAndRun(makeMemoryMetadataStore());
      const pg = await seedAndRun(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg).toEqual(EXPECTED);
    });
  });
});
