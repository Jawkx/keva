# Plan 019: Bound database aggregation and cleanup scans

> **Executor instructions**: Run the drift check first. Capture `EXPLAIN` plans
> on representative data before and after; do not add indexes by intuition alone.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/core/src/postgres/store.ts packages/core/src/postgres/schema.ts packages/core/drizzle`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Property summary aggregates every distinct scalar before JavaScript slices to
100, so high-cardinality tenants can create large database/Worker payloads.
Global lifecycle scans filter by status/time, but the only matching index starts
with tenant ID and cannot efficiently serve the cross-tenant job.

## Current state

- `packages/core/src/postgres/store.ts:499-525` performs `jsonb_agg(distinct ...)`
  over all values and then `.slice(0, SUGGESTION_VALUE_LIMIT)` in JavaScript.
- `store.ts:527-539` scans all tenants by `status` and `created_at`.
- `packages/core/src/postgres/schema.ts:45-52` has
  `(tenant_id,status,created_at)` but no status-first/partial cleanup index.

## Scope

**In scope**: SQL rewrites, lifecycle indexes/migration, deterministic ordering,
and `EXPLAIN` evidence.

**Out of scope**: generic denormalization or a search service.

## Steps

1. Seed representative high-cardinality properties and lifecycle rows, capture
   execution plans and transferred result sizes.
2. Rank/deduplicate values per key and apply the value limit before aggregation.
   Preserve stable cross-store ordering and tag/kind semantics.
3. Add a status/created-at or partial pending/deleting index selected by actual
   cleanup query plans. Use a normal forward migration.

## Verification

- Saved `EXPLAIN` comparison in plan/PR notes -> bounded aggregate and indexed cleanup scan.
- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Postgres does not materialize/transmit more than the configured values per key.
- Cleanup batches use an index matching their global predicate/order.

## STOP conditions

- STOP if stable memory/Postgres value ordering cannot be specified; define it in
  the shared contract first.
- STOP if index write amplification outweighs measured scan benefit at expected
  scale; record the rejected index with evidence.

## Maintenance notes

Revisit these queries when suggestion limits, lifecycle states, or table scale
change.
