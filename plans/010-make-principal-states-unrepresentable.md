# Plan 010: Make invalid principal states unrepresentable

> **Executor instructions**: Run the drift check first. Use exhaustive
> discriminated unions; do not retain optional share context on every variant.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/schema/src/index.ts packages/core/src/engine.ts apps/server/src/auth.ts apps/server/src/shares.ts apps/server/src/mcp.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 009
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

The schema documents that share context exists iff `via === "share"`, but its
type makes context optional. Existing constructors always populate the context,
so this is not a demonstrated current bypass; it is a type-level authorization
footgun that can become exploitable when adding a decoder or constructor.

## Current state

- `packages/schema/src/index.ts:166-175` defines one struct with optional
  `share` for all `via` values.
- `packages/core/src/engine.ts:36-49` turns a context-free share principal into
  `null` and uses that to skip share-only guards.
- Current constructors in `apps/server/src/shares.ts:93-108` populate context,
  but the shared decoder and future constructors are not protected.

## Scope

**In scope**: Principal schema/type, all constructors, and guards.

**Out of scope**: tenant/role policy (plan 009) and changing scope names.

## Steps

1. Replace `Principal` with session, token, and share schema variants. Require
   share context only on share and forbid it on other variants.
2. Update engine authorization to switch exhaustively on `via`; remove
   presence-based `shareOf` authorization semantics.
3. Update every constructor and decoder. Keep actor attribution orthogonal to
   authorization.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- TypeScript and runtime schemas cannot represent context-free share principals.
- Authorization uses the discriminant exhaustively.

## STOP conditions

- STOP if any external serialized Principal consumer exists; inventory and plan
  its migration before changing the wire shape.

## Maintenance notes

Add future credential modes as explicit variants with variant-specific required
context and exhaustive authorization branches.
