# Plan 008: Make item history durable with metadata mutations

> **Executor instructions**: Run the drift check first. Preserve object-store
> idempotency and do not make external S3 calls part of a database transaction.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/core/src/engine.ts packages/core/src/services.ts packages/core/src/postgres packages/core/drizzle packages/schema/src/index.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 003
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

History is advertised as append-only mutation history, but every append failure
is ignored after the mutation commits. Transient database failures permanently
erase audit events and make history unsuitable for trust, support, or automation.

## Current state

- `packages/core/src/engine.ts:65-84` pipes every `appendEvent` through
  `Effect.ignore`.
- Patch/delete transitions commit at `engine.ts:278-307` and `377-387` before a
  separate event insert.
- `packages/core/src/postgres/store.ts:542-553` inserts events independently.
- Events intentionally outlive items (`postgres/schema.ts:62-87`), which must be
  preserved.

## Scope

**In scope**: transactional metadata mutation-plus-event store APIs and memory/
Postgres equivalence.

**Out of scope**: storing file contents in history or exposing share visitors to
actor/property history.

## Steps

1. Define atomic store commands for confirm metadata transition, patch, and
   delete claim that insert their event in the same database transaction.
2. Keep S3 copy/delete outside database transactions. Confirmation may copy
   first, then atomically transition plus insert its event; retrying the copy and
   confirmation must remain idempotent.
3. Remove blanket event-error suppression. A database failure must roll back both
   metadata mutation and event insertion.
4. Preserve no-op patch and idempotent reconfirm behavior without duplicate
   events. Do not add an outbox unless events later need external delivery.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- A successful metadata mutation has exactly its required durable event.
- Failure to persist the event cannot leave an unrecorded committed mutation.
- External blob operations remain retryable and outside DB transactions.

## STOP conditions

- STOP if an implementation holds a database transaction open during network
  object-store I/O.
- STOP if the design introduces an outbox without an external event consumer.

## Maintenance notes

New user-visible mutations must use an atomic mutation/event command, not call
`appendEvent` after the fact.
