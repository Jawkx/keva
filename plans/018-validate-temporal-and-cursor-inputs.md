# Plan 018: Validate temporal and cursor inputs consistently

> **Executor instructions**: Run the drift check first. Boundary validation must
> produce typed client errors before persistence/database parsing.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/schema/src/index.ts packages/core/src/memory.ts packages/core/src/postgres/store.ts apps/server/src/auth.ts apps/server/src/shares.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 017
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Token/share expirations accept arbitrary or past strings and fail only in
Postgres or create immediately dead credentials. Malformed cursors fail in
Postgres but silently restart pagination in memory, so local tests hide
production errors.

## Current state

- `packages/schema/src/index.ts:351-355` and `417-425` define expiration as an
  unconstrained string.
- `apps/server/src/auth.ts:217-226` and `shares.ts:151-168` persist it directly.
- `packages/core/src/memory.ts:44-55,157-168,296-307` maps malformed cursors to
  `null`/first page.
- `packages/core/src/postgres/store.ts:105-121` returns `ValidationError` after
  validating timestamp and ID.

## Scope

**In scope**: shared ISO-instant/future-instant schemas, shared cursor codec, and
memory/Postgres use.

**Out of scope**: changing cursor ordering/encoding for valid clients.

## Steps

1. Add strict ISO timestamp parsing and a request-time future-expiration check
   with an injectable clock for deterministic behavior.
2. Apply it to token/share creation and preserve nullable stored record decoding.
3. Extract one cursor codec validating base64 JSON, tuple shape, finite instant,
   and UUID. Return typed `ValidationError` in both stores.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Invalid/past expirations return typed 400 errors before database calls.
- Both metadata stores reject the same malformed cursors.

## STOP conditions

- STOP if existing clients intentionally create already-expired credentials;
  document that use case before preserving it.

## Maintenance notes

Reuse the temporal schema for every future expiration field; reuse the cursor
codec for item and event pagination.
