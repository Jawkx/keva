# Plan 003: Share one database unit of work per request

> **Executor instructions**: Run the drift check first. This is an enabling
> refactor: preserve behavior before moving invariants into transactions.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/server/src/server-options.ts apps/server/src/runtime.ts apps/server/src/auth.ts apps/server/src/shares.ts apps/server/src/views.ts apps/server/src/admin.ts packages/core/src/postgres`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

A Hyperdrive request constructs Better Auth plus separate postgres.js clients
for metadata, tokens, shares, and views, then disposes them all. This adds
connection/runtime overhead and prevents atomic operations spanning stores,
which is why several invariants are currently check-then-act.

## Current state

- `apps/server/src/server-options.ts:29-41` creates one postgres client for auth.
- `apps/server/src/runtime.ts:75-93` creates independent Postgres layers for
  metadata, tokens, shares, and views.
- `apps/server/src/auth.ts:256-263`, `shares.ts:214-221`, and
  `views.ts:131-138` each own another client lifecycle.
- `apps/server/src/worker.ts:99-104` repeats this per Hyperdrive request.

## Scope

**In scope**: database client construction/lifetime, store factory signatures,
request service wiring, disposal, and instrumentation.

**Out of scope**: isolate-global reuse unless Cloudflare/Hyperdrive documentation
explicitly proves it safe; business invariant changes belong to dependent plans.

## Steps

1. Define a request-scoped database service owning one postgres.js client and
   Drizzle facade. Inject it into all store factories and Better Auth setup.
2. Convert URL-owning `Postgres*Live` layers to factories/layers that accept the
   shared service. Keep URL convenience constructors only for standalone jobs if
   they have a real caller.
3. Make disposal happen exactly once after the request/job. Preserve Workerd
   request-lifetime restrictions and Node long-lived behavior.
4. Add instrumentation that exposes client construction/disposal counts during
   local verification without changing production output.

## Verification

- Local instrumentation -> one client is created and ended once per request.
- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Database-backed request services share one injected client/unit of work.
- No store silently constructs its own pool in request handling.
- Standalone migrations/jobs still close their client reliably.

## STOP conditions

- STOP if Better Auth requires ownership of a separate client; document that
  boundary and still consolidate Keva stores rather than forcing unsafe sharing.
- STOP before caching clients across requests without platform evidence.

## Maintenance notes

Plans 007-012 and 023 should consume this unit of work for transactions. Review
all future stores for accidental URL-based pool construction.
