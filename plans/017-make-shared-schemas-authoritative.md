# Plan 017: Make shared schemas authoritative across clients

> **Executor instructions**: Run the drift check first. Preserve useful
> surface-specific descriptions, but derive validity and types from
> `@keva/schema` rather than copying rules.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/schema packages/mcp apps/server/src/mcp.ts apps/admin/src/api.ts apps/server/src/admin.ts apps/web/src/lib/properties.ts packages/sdk/src/index.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

API, web, MCP, and admin independently recreate contracts. MCP omits valid query
features and accepts invalid property shapes, the web validator has different
limits, and admin casts arbitrary JSON to a duplicate interface. Contract drift
undermines the product's “one programmable core” architecture.

## Current state

- `packages/mcp/package.json:18-21` has no `@keva/schema` dependency;
  `packages/mcp/src/index.ts:5-36` recreates properties/query without `in` or
  `order` and types engine results as `Promise<unknown>` at `68-76`.
- `apps/web/src/lib/properties.ts:3-7` copies limits and pattern rules.
- `apps/admin/src/api.ts:1-22` duplicates `AdminUserUsage` and casts response JSON.
- `packages/sdk/src/index.ts:95-140` is the repository exemplar for decoding
  request/response bodies through Effect schemas.

## Scope

**In scope**: reusable schemas/helpers, MCP adapters and output types, admin
request/response schemas, and web validation consumption.

**Out of scope**: public item DTO redesign (plan 023) and UI conflict behavior
(plan 014).

## Steps

1. Inventory every HTTP/SDK/MCP/admin wire contract and assign one canonical
   Effect schema in `@keva/schema`; keep persistence-only records internal.
2. Export reusable complete-property validation and issue formatting hooks.
3. Build a deliberate Effect-schema-to-Zod/MCP adapter or derive equivalent MCP
   shapes. Add `in` and ordering only when supported end to end.
4. Type `McpEngine` inputs/results with canonical types and validate outputs
   before serialization.
5. Move admin schemas to the shared package and decode both success/errors.
6. Replace web validity copies with canonical parsing while preserving UI text.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Canonical operators/property limits produce identical acceptance across API,
  SDK, web, MCP, and admin.
- Admin/MCP no longer cast successful bodies to arbitrary generic/unknown types.

## STOP conditions

- STOP if tightening MCP breaks a documented accepted contract; introduce a
  versioned deprecation path.
- STOP if UI-only draft/coercion semantics are moved into the wire schema.

## Maintenance notes

Every new endpoint/tool should begin with a shared schema.
