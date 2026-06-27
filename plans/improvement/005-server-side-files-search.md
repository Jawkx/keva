# Plan 005: Make Files Search Server-Side and Paginated

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- packages/schema/src/index.ts packages/schema/src/index.test.ts packages/core/src/memory.ts packages/core/src/engine.test.ts packages/core/src/postgres/store.ts packages/core/src/postgres.test.ts packages/sdk/src/index.ts apps/web/src/pages/FilesPage.tsx`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness, UX
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

The Files screen appears to search by name or content type, but it only filters the rows already loaded into the browser. Since the first query loads 50 objects and hides Load More while searching, objects outside the first page are undiscoverable from the main browsing surface. The fix should make search part of the server query contract and preserve cursor pagination.

## Current state

- `FilesPage` always queries with an empty `where`:

```ts
// apps/web/src/pages/FilesPage.tsx:153-158
const result = await keva.query({
  where: [],
  limit: PAGE_SIZE,
  ...(reset ? {} : cursor ? { cursor } : {}),
});
```

- Filtering is purely client-side over loaded rows:

```ts
// apps/web/src/pages/FilesPage.tsx:192-199
globalFilterFn: (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const o = row.original;
  return (
    o.name.toLowerCase().includes(q) ||
    o.contentType.toLowerCase().includes(q)
  );
},
```

- Load More disappears while searching:

```tsx
// apps/web/src/pages/FilesPage.tsx:271
const loadMore = cursor && !search && (
```

- Query schema currently has only AND conditions:

```ts
// packages/schema/src/index.ts:161-170
export const Query = Schema.Struct({
  where: Schema.optionalWith(Schema.Array(QueryCondition), {
    default: () => [],
  }),
  limit: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 1000)),
    { default: () => 100 },
  ),
  cursor: Schema.optional(Schema.String),
});
```

Because backward compatibility is not required, adding a `search` field to `Query` is acceptable.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Schema tests | `pnpm --filter @keva/schema test` | all tests pass |
| Core tests | `pnpm --filter @keva/core test` | all non-env-gated tests pass |
| SDK tests | `pnpm --filter @keva/sdk test` | all tests pass |
| Web typecheck | `pnpm --filter @keva/web typecheck` | exit 0 |
| Server tests | `pnpm --filter @keva/server test` | all tests pass |

## Scope

**In scope**:
- `packages/schema/src/index.ts`
- `packages/schema/src/index.test.ts`
- `packages/core/src/memory.ts`
- `packages/core/src/engine.test.ts`
- `packages/core/src/postgres/store.ts`
- `packages/core/src/postgres.test.ts`
- `packages/sdk/src/index.ts` only if exported `Query` types require adjustment
- `apps/web/src/pages/FilesPage.tsx`

**Out of scope**:
- Full text search, trigram indexes, or new database indexes.
- Attribute search in the Files toolbar.
- Query page redesign.
- Infinite scroll.
- Changes to object lifecycle or authorization.

## Git workflow

- Branch: `advisor/005-server-side-files-search`
- Commit message style: plain imperative, for example `Add server-side file search`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Extend the shared Query schema

In `packages/schema/src/index.ts`, add an optional `search` string field to `Query`. Suggested contract:

- `search` is optional.
- Trim whitespace when evaluating.
- Empty or whitespace-only search behaves like no search.
- It searches object `name` and `contentType` only.
- It combines with `where` using AND: `(name/contentType match) AND all where conditions`.

Use Effect Schema validation, for example `Schema.optional(Schema.String.pipe(Schema.maxLength(256)))`.

**Verify**: `pnpm --filter @keva/schema typecheck` -> exit 0.

### Step 2: Add schema tests

In `packages/schema/src/index.test.ts`, add cases for:

- `{ search: "fox" }` decodes with defaults for `where` and `limit`.
- An overlong `search` fails if you added a max length.
- Empty query still decodes to `{ where: [], limit: 100 }` as before.

**Verify**: `pnpm --filter @keva/schema test` -> all tests pass.

### Step 3: Implement memory-store search

In `packages/core/src/memory.ts`, update `query` so it filters ready objects by `query.search` before pagination. Match existing case-insensitive UI behavior:

```ts
const term = query.search?.trim().toLowerCase();
const matchesSearch = !term || object.name.toLowerCase().includes(term) || object.contentType.toLowerCase().includes(term);
```

Apply search before sorting/cursor slicing.

**Verify**: `pnpm --filter @keva/core test` -> existing tests pass after Step 4 adds coverage.

### Step 4: Add core search tests

In `packages/core/src/engine.test.ts`, add a test that creates at least three ready objects in the same tenant, where only one matches by `name` and another matches by `contentType`. Assert:

- `query({ search: "term", where: [], limit: 100 })` returns matching objects.
- Another tenant cannot see matching objects.
- Pagination with `limit: 1` and `search` walks only matching rows.

**Verify**: `pnpm --filter @keva/core test` -> all non-env-gated tests pass, including the new search test.

### Step 5: Implement Postgres search

In `packages/core/src/postgres/store.ts`, when `query.search?.trim()` is non-empty, add a predicate:

```sql
(name ilike ${pattern} or content_type ilike ${pattern})
```

Escape `%`, `_`, and backslash in the user input before adding `%` wildcards. Use SQL parameters, not string interpolation. Keep tenant and `status = 'ready'` predicates first as they are today.

**Verify**: `pnpm --filter @keva/core typecheck` -> exit 0.

### Step 6: Add Postgres search coverage

In `packages/core/src/postgres.test.ts`, extend the query operator test or add a new DB-gated test for `search`, tenant scoping, and pagination. Keep it skipped when `KEVA_TEST_DATABASE_URL` is absent.

**Verify**: with a test database, `KEVA_TEST_DATABASE_URL=<test db> pnpm --filter @keva/core test` -> Postgres tests pass.

### Step 7: Update FilesPage to query the server

In `apps/web/src/pages/FilesPage.tsx`:

- Remove `globalFilterFn` and `globalFilter` state usage from TanStack table.
- Keep `search` as input state.
- Add explicit "Run" behavior or debounce. Prefer a simple form submit or button to avoid adding direct `useEffect`.
- When the search term changes and the user submits, call `load(true)` with `search: search.trim() || undefined`.
- Keep Load More visible whenever `cursor` exists, including during search.
- Ensure reset clears previous rows and cursor.

Because this repo has a no-direct-useEffect convention, do not add `useEffect`. Use event handlers, `useMountEffect`, or key-based resets.

**Verify**: `pnpm --filter @keva/web typecheck` -> exit 0.

### Step 8: Run end-to-end package checks

Run package-level tests/typechecks.

**Verify**:

- `pnpm --filter @keva/schema test` -> pass
- `pnpm --filter @keva/core test` -> pass, with DB-gated tests skipped if env missing
- `pnpm --filter @keva/sdk test` -> pass
- `pnpm --filter @keva/server test` -> pass
- `pnpm --filter @keva/web typecheck` -> pass

## Test plan

- Schema test for new `search` field validation/defaulting.
- Core memory test for search by name, search by content type, tenant scoping, and pagination.
- DB-gated Postgres test for the same semantics.
- Web typecheck for FilesPage changes.

## Done criteria

- [ ] `Query` has a documented `search` field in schema.
- [ ] Memory and Postgres metadata stores implement `search` consistently.
- [ ] FilesPage search calls the server and can paginate search results.
- [ ] Load More is available for search results when `nextCursor` exists.
- [ ] No direct `useEffect` is added to React components.
- [ ] All verification commands in Step 8 pass.
- [ ] `plans/improvement/README.md` status row for plan 005 is updated.

## STOP conditions

Stop and report if:

- Search requires OR support across arbitrary query conditions, not just name/contentType.
- Adding `search` breaks Effect Schema decoding in SDK/server in a way that requires broad API rewrites.
- The FilesPage fix seems to require direct `useEffect` in a component.

## Maintenance notes

This is intentionally not full text search. If search becomes a hot path, add a later plan for indexes such as trigram/full-text on `name` and `content_type`.

