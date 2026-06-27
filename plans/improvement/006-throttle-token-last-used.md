# Plan 006: Throttle API Token Last-Used Writes

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- apps/server/src/auth.ts apps/server/src/tokens.test.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

Every successful API-token request currently updates `last_used_at`. For read-heavy agents or SDK clients, this turns all reads into writes, adding latency and database row churn. The UI only needs approximate last-used freshness, so throttling the write is a simple operational win.

## Current state

`apps/server/src/auth.ts` updates on every resolved token:

```ts
// apps/server/src/auth.ts:188-192
const candidate = await hashSecret(secret!);
if (!secureEqual(candidate, row.secret_hash)) return null;
await sql`
  update api_tokens set last_used_at = now() where id = ${row.id}
`;
return {
```

Token list UI displays `lastUsedAt`, but no code requires per-request precision.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server typecheck | `pnpm --filter @keva/server typecheck` | exit 0 |
| Server tests | `pnpm --filter @keva/server test` | all tests pass |

## Scope

**In scope**:
- `apps/server/src/auth.ts`
- `apps/server/src/tokens.test.ts` or a new `apps/server/src/auth.test.ts`

**Out of scope**:
- API token schema changes.
- Token management UI changes.
- Background jobs.
- Metrics/observability.

## Git workflow

- Branch: `advisor/006-throttle-token-last-used`
- Commit message style: plain imperative, for example `Throttle API token last-used writes`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a throttle interval constant

In `apps/server/src/auth.ts`, define a module-level constant near token-store code:

```ts
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
```

or a SQL interval string:

```ts
const LAST_USED_UPDATE_INTERVAL_SQL = "5 minutes";
```

Do not make this configurable unless the maintainer asks. A fixed five-minute window is enough.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0 after Step 2.

### Step 2: Update only when stale

Change the SQL update so it writes only when `last_used_at` is missing or older than the throttle window. Suggested SQL:

```sql
update api_tokens
set last_used_at = now()
where id = ${row.id}
  and (last_used_at is null or last_used_at < now() - interval '5 minutes')
```

Do not block authentication on whether the update matched a row; token resolution should still return the principal after a valid secret.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0.

### Step 3: Add focused coverage

Existing `tokens.test.ts` uses an in-memory token store and will not exercise this SQL. Add one of these:

- Preferred: a small unit test around a pure helper if you extract one, for example `shouldRefreshLastUsed(lastUsedAt, now)`.
- Acceptable: an env-gated Postgres token-store test if a test DB is already available.

The test should cover:

- null `lastUsedAt` should refresh.
- a value newer than five minutes should not refresh.
- a value older than five minutes should refresh.

If you use a pure helper, keep it internal or non-exported unless exporting is necessary for testing.

**Verify**: `pnpm --filter @keva/server test` -> all tests pass.

## Test plan

- Add focused test coverage for the throttle decision.
- Existing server token tests should continue to pass unchanged, proving token auth, scope enforcement, list, and revoke still work.

## Done criteria

- [ ] Valid token resolution no longer writes `last_used_at` on every request.
- [ ] Last-used still updates when it is null or older than the throttle interval.
- [ ] Token authentication behavior and returned `Principal` are unchanged.
- [ ] `pnpm --filter @keva/server typecheck` exits 0.
- [ ] `pnpm --filter @keva/server test` exits 0.
- [ ] `plans/improvement/README.md` status row for plan 006 is updated.

## STOP conditions

Stop and report if:

- Testing the throttle requires broad database test infrastructure. In that case, add only the SQL change and propose combining coverage with Plan 004.
- The token list UI or API contract requires per-request last-used precision.
- The SQL library rejects the interval expression in a way that requires raw unsafe SQL.

## Maintenance notes

If product requirements later need exact token usage auditing, add a separate append-only usage event stream. Do not turn the auth hot path back into one write per read request.

