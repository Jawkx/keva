# Plan 02: The in-memory and Postgres stores return identical query results

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/improvement/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c454b4..HEAD -- packages/core/src/postgres/store.ts packages/core/src/memory.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (correctness) + tests
- **Planned at**: commit `9c454b4`, 2026-06-30

## Why this matters

keva ships **two** `MetadataStore` adapters that must behave identically: the
in-memory store (`memory.ts`, the zero-DB dev/self-host path and the backend
the entire server test suite runs on) and the Postgres store (`postgres/store.ts`,
production). They currently **disagree** on one query case, and there is no test
that runs the same query against both and compares — so the divergence is
invisible and the memory store gives false confidence in CI.

The divergence: `neq` against a **system column** with a **type-mismatched
operand** (e.g. `{ key: "system.size", op: "neq", value: "x" }` — a string
operand against the numeric `size` column). Under keva's documented
**type-strict, no-coercion** semantics (`plans/data-model.md`, "Operator × type
matrix"), a present value of a different type is necessarily unequal to the
operand, so `neq` should **match**. The in-memory store does match; Postgres
returns no rows because a blanket type-guard short-circuits *every* operator to
`false` on a type mismatch — which is correct for `eq`/ordering/`contains` but
wrong for `neq`. (This guard is also why both stores agree on the JSONB
*property* path, where Postgres handles `neq` separately — only the system-column
branch is wrong.)

After this plan: the Postgres system-column `neq` matches the in-memory store,
and a new store-equivalence test runs a battery of queries against both stores
and asserts identical results, so any future divergence fails CI.

## Current state

### The reference behavior — in-memory store (`packages/core/src/memory.ts`)

```ts
// lines ~46-47
const equals = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && Object.is(left, right);
```
```ts
// inside matches(), lines ~55-57
case "eq":
  return equals(candidate.value, operand);
case "neq":
  return !equals(candidate.value, operand);
```
For a declared field (id, name, `system.*`), `valueAt` always reports
`exists: true` with the column value (or `null`). So `neq` with a
different-typed operand → `equals` is `false` (types differ) → `neq` returns
`true` (matches). This is the behavior to match.

### The bug — Postgres store (`packages/core/src/postgres/store.ts`)

In `compileCondition`, the system-column branch (lines ~123–138):
```ts
const column = systemColumn(sql, condition.key);
const value = condition.value;
if (column) {
  if (condition.op === "exists") return sql`true`;
  const expected = column.type === "number" ? "number" : "string";
  if (value !== null && typeof value !== expected) return sql`false`;   // <-- wrong for neq
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
  // ... contains, then ordering ...
}
```
The `if (value !== null && typeof value !== expected) return sql\`false\`` runs
*before* the `neq` branch, so a type-mismatched `neq` wrongly returns no rows.

### Conventions

- Tests use `vitest` (`vitest run src`), colocated as `src/*.test.ts`.
- The DB-gated test pattern to mirror is `packages/core/src/postgres.test.ts`:
  it reads `KEVA_TEST_DATABASE_URL`, applies migrations from `../drizzle`, uses
  `describe.skipIf(!DATABASE_URL)`, and seeds items via the engine using a
  shared `MemoryBlobStoreLive` (so `confirm` can `head`/`copy` the staged bytes).
  Reuse that exact scaffolding.

## Commands you will need

| Purpose            | Command                                                   | Expected |
|--------------------|-----------------------------------------------------------|----------|
| Install            | `pnpm install`                                            | exit 0   |
| Typecheck (core)   | `pnpm --filter @keva/core typecheck`                      | exit 0   |
| Test (core, no DB) | `pnpm --filter @keva/core test`                           | all pass (Postgres parts auto-skip) |
| Test (core, w/ DB) | `KEVA_TEST_DATABASE_URL=postgres://… pnpm --filter @keva/core test` | all pass incl. equivalence |
| Lint               | `pnpm lint`                                               | exit 0   |

To run the DB-gated part locally you need a reachable Postgres. If you do not
have one, the memory-only assertions still run and must pass; note in your
report that the cross-store comparison was skipped.

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/postgres/store.ts` (the `neq` fix — a few lines)
- `packages/core/src/store-equivalence.test.ts` (create)
- `plans/improvement/README.md` (status row only)

**Out of scope** (do NOT touch):
- `packages/core/src/memory.ts` — it is the reference; do not change its semantics.
- `packages/core/src/postgres.test.ts` — leave the existing suite alone.
- The query *schema* / operator validation in `packages/schema` — unchanged.
- Any other operator in `compileCondition` — only system-column `neq` is wrong.

## Git workflow

- Branch: `advisor/02-store-equivalence`.
- One or two commits. Short imperative messages (match `git log`).
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Fix system-column `neq` in the Postgres store

In `packages/core/src/postgres/store.ts`, in `compileCondition`'s `if (column)`
branch, replace these two lines:

```ts
    const expected = column.type === "number" ? "number" : "string";
    if (value !== null && typeof value !== expected) return sql`false`;
```

with:

```ts
    const expected = column.type === "number" ? "number" : "string";
    const typeMismatch = value !== null && typeof value !== expected;
    // Type-strict (no coercion): a present column value of a different type
    // than the operand is necessarily unequal to it, so `neq` matches every
    // ready, in-tenant row — identical to the in-memory store and the JSONB
    // property path. Every other operator (eq, ordering, contains) cannot
    // match across types, so they yield no rows.
    if (condition.op === "neq" && typeMismatch) return sql`true`;
    if (typeMismatch) return sql`false`;
```

Leave the rest of the branch unchanged.

**Verify**: `pnpm --filter @keva/core typecheck` → exit 0.

### Step 2: Add the store-equivalence test

Create `packages/core/src/store-equivalence.test.ts`. It seeds the **same**
logical items into a store, runs a fixed battery of queries, and returns each
query's matching item **names** (sorted) — names are stable across stores even
though ids are random. The memory store is asserted against the expected results
always; the Postgres store is asserted equal to memory only when
`KEVA_TEST_DATABASE_URL` is set.

```ts
import type { Principal, Query } from "@keva/schema";
import { Effect, Layer } from "effect";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeKevaEngine } from "./engine.js";
import { MemoryBlobStoreLive, MemoryMetadataStoreLive } from "./memory.js";
import { makePostgresMetadataStore } from "./postgres/store.js";
import { BlobStore, MetadataStore, type MetadataStoreService } from "./services.js";

const DATABASE_URL = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env?.KEVA_TEST_DATABASE_URL;

const principal = (tenantId: string): Principal => ({
  tenantId,
  scopes: ["read", "write", "delete", "admin"],
  via: "token",
});

// Seed items: [name, contentType, properties]
const SEED: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ["alpha", "text/plain", { kind: "doc", rating: 5, tags: ["x", "y"], note: "hello world" }],
  ["bravo", "image/png", { kind: "image", rating: 10, tags: ["y", "z"] }],
  ["carol", "application/pdf", { kind: "doc", rating: 1, label: null }],
];

// Query battery. Compare matching item NAMES (sorted).
const QUERIES: Record<string, Query> = {
  eqString: { where: [{ key: "kind", op: "eq", value: "doc" }], limit: 100 },
  neqString: { where: [{ key: "kind", op: "neq", value: "image" }], limit: 100 },
  arrayMember: { where: [{ key: "tags", op: "contains", value: "y" }], limit: 100 },
  substring: { where: [{ key: "note", op: "contains", value: "world" }], limit: 100 },
  rangeNumber: { where: [{ key: "rating", op: "gte", value: 5 }], limit: 100 },
  existsKey: { where: [{ key: "label", op: "exists" }], limit: 100 },
  eqNull: { where: [{ key: "label", op: "eq", value: null }], limit: 100 },
  // property neq with a type-mismatched operand (string vs number values)
  neqPropTypeMismatch: { where: [{ key: "rating", op: "neq", value: "5" }], limit: 100 },
  // system column eq
  sysContentTypeEq: { where: [{ key: "system.content_type", op: "eq", value: "image/png" }], limit: 100 },
  // system column neq, SAME type
  sysContentTypeNeq: { where: [{ key: "system.content_type", op: "neq", value: "image/png" }], limit: 100 },
  // system column neq, MISMATCHED type — the case this plan fixes
  sysSizeNeqTypeMismatch: { where: [{ key: "system.size", op: "neq", value: "x" }], limit: 100 },
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

// Seed the three items (each uploaded → confirmed → patched) into `store`,
// then run every query and return queryName -> sorted matching names.
const seedAndRun = async (
  store: MetadataStoreService,
): Promise<Record<string, string[]>> => {
  const tenant = crypto.randomUUID();
  const p = principal(tenant);
  const layer = Layer.merge(Layer.succeed(MetadataStore, store), MemoryBlobStoreLive());
  const run = <A, E>(e: Effect.Effect<A, E, BlobStore | MetadataStore>) =>
    Effect.runPromise(e.pipe(Effect.provide(layer)));

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
    results[label] = res.items.map((i) => i.name).sort();
  }
  return results;
};

describe("store query equivalence", () => {
  it("the in-memory store matches the specified semantics", async () => {
    const got = await seedAndRun(MemoryMetadataStoreLive.pipe);
    // NOTE: MemoryMetadataStoreLive is a Layer; build a fresh store instance:
    expect(got).toBeDefined();
  });
});
```

> The skeleton above shows the data and intent. **One adjustment you must make**:
> `seedAndRun` needs a `MetadataStoreService` *instance*, not the Layer. Use the
> factory functions directly:
> - in-memory: `makeMemoryMetadataStore()` (export it from `memory.ts` if it
>   isn't already exported — it is exported there as `makeMemoryMetadataStore`),
> - Postgres: `makePostgresMetadataStore(sql)`.
>
> Replace the placeholder `it(...)` with the two real tests below.

Real test bodies (replace the placeholder `describe` body with this):

```ts
describe("store query equivalence", () => {
  it("the in-memory store matches the specified semantics", async () => {
    const got = await seedAndRun(makeMemoryMetadataStore());
    expect(got).toEqual(EXPECTED);
  });

  describe.skipIf(!DATABASE_URL)("postgres equals memory", () => {
    let sql: Sql;
    beforeAll(async () => {
      sql = postgres(DATABASE_URL!, { max: 4 });
      const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
      for (const file of (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
        const migration = await readFile(resolve(dir, file), "utf8");
        for (const stmt of migration.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
          await sql.unsafe(stmt);
        }
      }
    });
    afterAll(async () => { await sql.end({ timeout: 5 }); });

    it("returns identical results for every query in the battery", async () => {
      const memory = await seedAndRun(makeMemoryMetadataStore());
      const pg = await seedAndRun(makePostgresMetadataStore(sql));
      expect(pg).toEqual(memory);
      expect(pg).toEqual(EXPECTED);
    });
  });
});
```

Add `makeMemoryMetadataStore` to the import from `./memory.js`.

**Verify (no DB)**: `pnpm --filter @keva/core test` → all pass; the memory-store
equivalence test passes and the Postgres block is skipped.

### Step 3 (only if you have a Postgres): prove cross-store equality

Run `KEVA_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/keva_test pnpm --filter @keva/core test`.

**Verify**: the `postgres equals memory` test passes — confirming the Step 1 fix
makes `sysSizeNeqTypeMismatch` (and every other query) identical across stores.
If you do **not** have a Postgres, skip this step and say so in your report; CI
runs it (CI provisions Postgres and sets `KEVA_TEST_DATABASE_URL`).

## Test plan

- New file `packages/core/src/store-equivalence.test.ts`:
  - Memory store vs `EXPECTED` (always runs) — locks the documented semantics.
  - Postgres store vs memory store (DB-gated) — the regression guard; the
    `sysSizeNeqTypeMismatch` query is the one that fails before Step 1.
- Pattern source: `packages/core/src/postgres.test.ts` (DB gating, migration
  application, engine-based seeding with a shared memory blob store).

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @keva/core typecheck` exits 0
- [ ] `pnpm --filter @keva/core test` exits 0 (memory equivalence passes; PG block
      skipped without a DB)
- [ ] With `KEVA_TEST_DATABASE_URL` set (or in CI): the `postgres equals memory`
      test passes, including `sysSizeNeqTypeMismatch`
- [ ] `pnpm lint` exits 0
- [ ] `memory.ts` is unmodified (`git status`)
- [ ] `git status` shows only `packages/core/src/postgres/store.ts`,
      `packages/core/src/store-equivalence.test.ts`, and
      `plans/improvement/README.md` changed
- [ ] `plans/improvement/README.md` status row for plan 02 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live `store.ts`/`memory.ts`.
- The memory-store equivalence test does **not** match `EXPECTED` *before* you
  touch Postgres — that means the reference behavior differs from what this plan
  assumed (e.g. a seeded item didn't reach `ready`, or `patch` rejected a
  property). Report the actual `got` map; do not adjust `EXPECTED` to whatever
  the code happens to produce.
- The Postgres test reveals divergences **beyond** `sysSizeNeqTypeMismatch`
  (i.e. other query labels differ between stores). Report them; do not silently
  "fix" additional cases by guessing semantics — that needs a decision.

## Maintenance notes

- For the reviewer: confirm the fix is confined to the system-column `neq` case
  and that `eq`/ordering/`contains` on type-mismatched operands still return no
  rows (they must remain `sql\`false\``).
- This equivalence harness is the place to add a row whenever a new operator or
  query feature lands — extend `QUERIES`/`EXPECTED` and both stores stay honest.
- Lower-priority consistency nit found nearby but intentionally **out of scope**:
  `listByStatus` orders by `created_at` only (no secondary `id`) in both stores
  (`memory.ts` ~line 214, `store.ts` ~lines 301/306), unlike the keyset
  `(created_at, id)` ordering used by `query`. It is harmless today (the
  reaper/sweeper jobs are idempotent). If you want to tidy it, do it as a
  separate change with its own review — not in this plan.
