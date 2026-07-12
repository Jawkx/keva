# Plan 002: Close the storage lifecycle cleanup loop

> **Executor instructions**: Run the drift check first. Cleanup must be
> idempotent, bounded, observable, and safe under overlapping invocations.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/core/src/engine.ts packages/core/src/services.ts packages/core/src/postgres apps/server/src/jobs.ts apps/server/src/worker.ts apps/server/wrangler.toml`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 001
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Pending uploads reserve quota and failed deletes remain incomplete until cleanup
runs. The deployed Worker has no scheduled handler, while confirmation ignores
staging-delete failures and no job revisits ready items' staging keys.

## Current state

- `packages/core/src/engine.ts:396-428` exposes `reapPending` and
  `sweepDeleting` only.
- `apps/server/src/jobs.ts:19-25` is a manual Node one-shot command.
- `apps/server/src/worker.ts:92-114` has only `fetch`; `wrangler.toml` has no
  scheduled trigger.
- `packages/core/src/engine.ts:199-216` marks an item ready, ignores staging
  deletion failure, and loses the cleanup obligation.

## Scope

**In scope**: lifecycle state/cleanup model, Worker scheduled handler and cron,
Node job parity, bounded batching, observability, and documented
bucket lifecycle defense.

**Out of scope**: changing user-visible retention policy or deleting ready final
objects without metadata state authorizing it.

## Steps

1. Choose a durable representation for staging cleanup obligations: an outbox or
   explicit cleanup state written before/with ready transition. Do not rely only
   on an in-process retry.
2. Extend cleanup to retry staging deletion, pending reaping, and deleting-item
   sweeps in bounded batches with idempotent claims.
3. Add Worker `scheduled` wiring and a Wrangler cron; retain a Node command using
   the same program, not duplicate logic.
4. Emit structured counts/failures without object keys, credentials, or user
   metadata. Document an age-based `staging/` bucket lifecycle as defense in
   depth, not the primary correctness mechanism.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Every abandoned reservation and staging object has a durable cleanup path.
- Scheduled production cleanup is checked into deployment configuration.
- Repeated/overlapping cleanup produces the same final state.

## STOP conditions

- STOP if cleanup cannot identify ownership/state without guessing from object
  keys; add durable metadata instead.
- STOP if the chosen cron cadence can race active uploads without an atomic claim
  or age cutoff.

## Maintenance notes

Review lifecycle metrics after changing upload TTL, batch size, or quota logic.
Bucket lifecycle expiration must remain longer than the maximum active upload and
confirmation window.
