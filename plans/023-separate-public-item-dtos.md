# Plan 023: Separate public item DTOs from persistence records

> **Executor instructions**: Run the drift check first. Confirm external SDK
> consumers before removing fields; this repository is version `0.0.0`, but do
> not assume no consumer exists.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/schema/src/index.ts packages/core/src packages/sdk/src apps/server/src/app.ts apps/web/src README.md`

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 017
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

`KevaItem` combines user-facing metadata with tenant ID and physical storage/
staging keys, and the owner API/SDK returns that persistence shape. Storage
topology therefore becomes an accidental public contract and forces optimistic
web rows to invent fake internal values.

## Current state

- `packages/schema/src/index.ts:66-83` includes `tenantId`, `storageKey`, and
  `stagingKey` in `KevaItem`.
- `packages/sdk/src/index.ts:65,176-223` exports/decodes that shape publicly.
- `apps/web/src/pages/FilesPage.tsx:167-177` fabricates empty/`"pending"`
  internal fields for optimistic rows.
- `packages/schema/src/index.ts:458-490` already defines a redacted share DTO,
  proving route-boundary redaction is established practice.

## Scope

**In scope**: separate persistence record and owner-facing DTO schemas, route
mapping, SDK/web types, optimistic-row model, and deprecation/migration policy.

**Out of scope**: changing object-key layout or exposing new tenant data.

## Steps

1. Inventory any consumers of owner item internal fields inside and outside the
   monorepo. Decide immediate removal vs a versioned deprecation period.
2. Define an internal persistence record in core and a public owner DTO in
   schema. Share DTO may reuse/derive from the public shape where privacy permits.
3. Map at every HTTP boundary and decode public DTOs in SDK. Keep storage keys
   available only to core/blob operations.
4. Model optimistic upload rows as an explicit UI union, not fake `KevaItem`
   records with placeholder internals.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Physical storage and tenant bookkeeping are absent from public item responses.
- Core retains a typed persistence record with no unsafe public casts.
- Optimistic UI rows no longer fabricate persistence fields.

## STOP conditions

- STOP if a shipped consumer relies on an internal field; publish a deprecation
  and major-version migration plan before removal.
- STOP if mapping logic is duplicated across routes; centralize one DTO mapper.

## Maintenance notes

Review every persistence field addition for whether it belongs in a public DTO;
default to internal.
