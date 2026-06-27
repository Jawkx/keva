# Plan 004: Add Real Postgres Migration and S3 Compatibility Gates

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- packages/core/src/postgres.test.ts packages/core/drizzle/0000_wandering_spiral.sql packages/core/package.json apps/server/src/s3-flow.test.ts apps/server/src/test/s3-mock.ts apps/server/package.json package.json pnpm-lock.yaml`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

The most important production risks are Postgres query semantics, migrations/indexes, and real S3-compatible uploads. Existing tests cover a lot, but the Postgres suite is skipped unless `KEVA_TEST_DATABASE_URL` is set and creates a minimal table instead of applying the checked-in migration. The S3 flow uses a mock that explicitly does not validate SigV4 signatures, so provider/browser incompatibilities can pass.

## Current state

- Postgres tests are gated and skipped by default:

```ts
// packages/core/src/postgres.test.ts:10-13
 * DB-gated acceptance for the Postgres metadata store. Requires a reachable
 * Postgres via KEVA_TEST_DATABASE_URL; when unset the whole suite is SKIPPED
 * (never failed) so the default suite passes with no database available.
```

- The test creates only a minimal objects table:

```ts
// packages/core/src/postgres.test.ts:36-57
const createSchema = async (sql: Sql): Promise<void> => {
  await sql`
    create table if not exists objects (
      id uuid primary key,
      tenant_id text not null,
      ...
      attributes jsonb not null default '{}'::jsonb,
      unique (tenant_id, id)
    )
  `;
};
```

- The real migration creates indexes that the test does not verify:

```sql
-- packages/core/drizzle/0000_wandering_spiral.sql:115-121
CREATE INDEX "api_tokens_tenant_created_idx" ON "api_tokens" USING btree ("tenant_id","created_at");
CREATE UNIQUE INDEX "objects_tenant_id_id_unique" ON "objects" USING btree ("tenant_id","id");
CREATE INDEX "objects_tenant_status_created_idx" ON "objects" USING btree ("tenant_id","status","created_at");
CREATE INDEX "objects_tenant_content_type_idx" ON "objects" USING btree ("tenant_id","content_type");
CREATE INDEX "objects_tenant_size_idx" ON "objects" USING btree ("tenant_id","size");
CREATE INDEX "objects_tenant_created_id_idx" ON "objects" USING btree ("tenant_id","created_at","id");
CREATE INDEX "objects_attributes_gin_idx" ON "objects" USING gin ("attributes");
```

- S3 mock does not validate signatures:

```ts
// apps/server/src/test/s3-mock.ts:10-15
 * Minimal in-memory S3-compatible server for tests (no Docker/MinIO needed).
 * Implements the subset the BlobStore uses: PUT (incl. CopyObject via
 * x-amz-copy-source), GET, HEAD, DELETE, path-style. It does NOT validate
 * signatures
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Core tests no DB | `pnpm --filter @keva/core test` | exits 0; DB-gated tests may skip when env missing |
| Server tests no S3 | `pnpm --filter @keva/server test` | exits 0 |
| Core typecheck | `pnpm --filter @keva/core typecheck` | exit 0 |
| Server typecheck | `pnpm --filter @keva/server typecheck` | exit 0 |
| DB integration | `KEVA_TEST_DATABASE_URL=<test db> pnpm --filter @keva/core test` | exits 0 and runs Postgres tests |
| S3 integration | `KEVA_TEST_S3_ENDPOINT=<endpoint> KEVA_TEST_S3_ACCESS_KEY_ID=<id> KEVA_TEST_S3_SECRET_ACCESS_KEY=<secret> KEVA_TEST_S3_BUCKET=<bucket> pnpm --filter @keva/server test` | exits 0 and runs real-provider S3 tests |

Do not commit real credentials or `.env` contents. Use environment variables only.

## Scope

**In scope**:
- `packages/core/src/postgres.test.ts`
- `packages/core/package.json` if Node test helpers or scripts are needed
- `apps/server/src/s3-flow.test.ts`
- `apps/server/package.json` if integration scripts are useful
- `package.json` if root scripts are useful
- `pnpm-lock.yaml` only if dependencies are added

**Out of scope**:
- Plan 009 CI setup, which the user explicitly excluded.
- Production code changes in `packages/core/src/postgres/store.ts` or `packages/core/src/s3.ts`, unless a test exposes a real bug. If a real bug is exposed, STOP and report before fixing it.
- Docker Compose files unless the maintainer explicitly wants local orchestration.

## Git workflow

- Branch: `advisor/004-real-integration-gates`
- Commit message style: plain imperative, for example `Add real storage integration gates`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Make the Postgres test apply the checked-in migration

Replace the minimal `createSchema` helper in `packages/core/src/postgres.test.ts` with logic that applies `packages/core/drizzle/0000_wandering_spiral.sql` to the test database. Because that file contains Drizzle statement-breakpoint comments, split on the marker or run the statements in order after stripping empty/comment-only segments.

If importing `node:fs/promises` or `node:path` requires Node types in `@keva/core`, add `@types/node` as a devDependency to `packages/core/package.json` and set test-only types carefully. Keep production package code runtime-neutral.

**Verify**: `pnpm --filter @keva/core typecheck` -> exit 0.

### Step 2: Assert migration indexes exist

Add assertions in the Postgres suite after schema setup:

- `objects_attributes_gin_idx` exists and uses `gin`.
- `objects_tenant_status_created_idx` exists.
- `objects_tenant_created_id_idx` exists.
- `api_tokens_tenant_created_idx` exists.

Query `pg_indexes` or `pg_class`/`pg_index`. Keep assertions specific to names in the migration.

**Verify**: `KEVA_TEST_DATABASE_URL=<test db> pnpm --filter @keva/core test` -> Postgres tests run and pass.

### Step 3: Keep no-DB behavior non-failing but visible

When `KEVA_TEST_DATABASE_URL` is absent, keep the suite skipped so local default tests stay lightweight. Make the skip message or test name clear that migration coverage requires the env var.

**Verify**: `pnpm --filter @keva/core test` -> exits 0 and reports the Postgres suite skipped when env is missing.

### Step 4: Add a real S3-compatible integration path

In `apps/server/src/s3-flow.test.ts`, keep the existing in-memory mock tests. Add a separate `describe.skipIf(...)` block gated by real S3-compatible env vars:

- `KEVA_TEST_S3_ENDPOINT`
- `KEVA_TEST_S3_REGION` defaulting to `us-east-1` or `auto`
- `KEVA_TEST_S3_ACCESS_KEY_ID`
- `KEVA_TEST_S3_SECRET_ACCESS_KEY`
- `KEVA_TEST_S3_BUCKET`
- `KEVA_TEST_S3_FORCE_PATH_STYLE` defaulting to true

Use `S3BlobStoreLive` with those values and run the same core lifecycle checks: initiate, presigned PUT, confirm copy to final, download, delete/sweep. Generate unique object IDs through the engine and clean up any created keys in `afterEach` where possible.

**Verify**: `pnpm --filter @keva/server test` -> existing mock tests still pass with no env.

### Step 5: Document integration commands in scripts or test comments

If adding scripts, prefer names that make env requirements obvious, for example:

- `test:postgres` in `packages/core/package.json`
- `test:s3` in `apps/server/package.json`

If you do not add scripts, document the exact commands in comments near the gated tests.

**Verify**: `pnpm --filter @keva/core typecheck && pnpm --filter @keva/server typecheck` -> exit 0.

## Test plan

- New Postgres assertions should run only when `KEVA_TEST_DATABASE_URL` is set.
- Existing Postgres semantic tests should now run against the real migration schema, not a reduced hand-made table.
- New S3 provider tests should run only when the `KEVA_TEST_S3_*` env vars are set.
- Existing in-memory mock S3 tests must remain because they are cheap and deterministic.

## Done criteria

- [ ] `packages/core/src/postgres.test.ts` applies the checked-in migration SQL for DB-gated tests.
- [ ] Postgres tests assert key migration indexes exist.
- [ ] Default `pnpm --filter @keva/core test` still exits 0 without a DB.
- [ ] Real DB command with `KEVA_TEST_DATABASE_URL` runs the Postgres suite against migration-created tables.
- [ ] `apps/server/src/s3-flow.test.ts` has an env-gated real S3-compatible provider suite.
- [ ] Default `pnpm --filter @keva/server test` still exits 0 without S3 env vars.
- [ ] No real credentials or `.env` values are committed.
- [ ] `plans/improvement/README.md` status row for plan 004 is updated.

## STOP conditions

Stop and report if:

- Applying the checked-in migration requires destructive operations against a non-test database.
- Real S3 compatibility tests reveal a production signing bug in `packages/core/src/s3.ts`; report the failing behavior before fixing production code.
- Adding test dependencies significantly changes the package manager lockfile beyond test-only packages.

## Maintenance notes

These gates are not a replacement for CI. They create the commands that CI should later run. Reviewers should confirm the env-gated tests are clear, safe for local dev, and impossible to run accidentally against production data.

