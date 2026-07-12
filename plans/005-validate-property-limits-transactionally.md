# Plan 005: Validate merged property limits transactionally

> **Executor instructions**: Run the drift check first. The authoritative check
> must run against the row locked for update, not an earlier engine snapshot.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/schema/src/fields.ts packages/schema/src/index.ts packages/core/src/engine.ts packages/core/src/services.ts packages/core/src/memory.ts packages/core/src/postgres/store.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 003
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Two individually valid patches can race from the same old snapshot and merge
into a property set over the key or byte limits. The code already locks the row
inside the store, but validates before entering that critical section.

## Current state

- `packages/core/src/engine.ts:250-277` computes merged limits from a pre-store
  `get` result.
- `packages/core/src/postgres/store.ts:323-345` locks and re-merges the latest row
  but does not rerun limits.
- `packages/core/src/memory.ts:123-141` has another merge implementation.
- Canonical limits live in `@keva/schema`; do not duplicate their arithmetic.

## Scope

**In scope**: a reusable canonical property-limit validator, metadata patch
contract/error type, and memory/Postgres patch implementations.

**Out of scope**: property-editor UX (plan 014) and unrelated query validation.

## Steps

1. Export a schema-level helper that validates a complete property record and
   returns a typed failure without throwing implementation-specific parse errors.
2. Invoke it inside each store patch after loading/locking the latest row and
   applying set/unset, before update/commit.
3. Remove the engine's stale-snapshot limit implementation while retaining
   route-field validation and stable `QuotaExceeded` behavior.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Every committed property record satisfies canonical limits under concurrency.
- Limit logic has one implementation shared by both stores and clients can still
  distinguish quota failure.

## STOP conditions

- STOP if store errors cannot represent validation/quota failures without
  widening public error contracts; update the contract explicitly first.

## Maintenance notes

Any future bulk patch/import path must call the same transactional validator.
