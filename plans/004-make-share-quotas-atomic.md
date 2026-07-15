# Plan 004: Make public-share quota reservation atomic

> **Executor instructions**: Run the drift check first. Do not solve this with a
> process-local mutex; Workers and Node processes are distributed.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/core/src/engine.ts packages/core/src/services.ts packages/core/src/postgres packages/core/drizzle`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 003
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Concurrent public uploads can all read the same share usage and then insert
separately, exceeding `maxItems` or `maxTotalBytes`. Share limits are a security
boundary for unauthenticated secret-link users, so the check and reservation
must share one transaction.

## Current state

- `packages/core/src/engine.ts:121-162` calls `sourceUsage`, checks limits, then
  calls `metadata.insert` as a separate operation.
- `packages/core/src/postgres/store.ts:461-472` computes an unlocked aggregate.
- `packages/core/src/engine.test.ts:677-746` exercises only sequential quota
  failures.
- Tenant-wide quota reservation at `store.ts:247-287` demonstrates the intended
  row-lock pattern but does not cover grant quotas.

## Scope

**In scope**: metadata-store reservation API and transaction-scoped per-share
locking in Postgres.

**Out of scope**: UI quota display (plan 013) and upload-body size enforcement
(plan 011).

## Steps

1. Define one store operation that accepts a typed grant ID and limits, validates
   tenant/share quota, and inserts the pending item in one transaction.
2. In Postgres, take a transaction-scoped advisory lock derived from tenant and
   grant identity, calculate current source usage inside that transaction, then
   validate and insert. Keep the existing tenant-usage row lock for tenant quota.
3. Do not add a new per-grant counter table unless advisory locking is
   unavailable or measured aggregation cost later justifies denormalization.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Quota check and pending-item reservation share one database transaction.
- Concurrent requests cannot exceed any configured share limit.
- Reaping/deleting naturally leaves the locked aggregate because source usage is
  derived from current pending/ready items.

## STOP conditions

- STOP if the design derives grant identity only by parsing `source`; introduce a
  typed reservation/grant identifier at the store boundary.
- STOP if transaction-scoped advisory locks are unavailable or cannot be keyed
  with acceptably low collision risk; evaluate a minimal per-grant lock row
  before introducing persisted counters.

## Maintenance notes

Any new upload source with limits should reuse this reservation primitive rather
than add another aggregate-then-insert path.
