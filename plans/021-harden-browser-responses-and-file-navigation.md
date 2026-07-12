# Plan 021: Harden browser responses and file navigation

> **Executor instructions**: Run the drift check first. Validate headers against
> PDF workers, blob previews, auth, and local development before enforcing them.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/server/src/worker.ts apps/web/index.html apps/admin/index.html apps/web/src/pages/FilesPage.tsx apps/web/src/pages/share/ShareItemList.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 012
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Static responses around bearer/share-token surfaces have no repository-defined
CSP, frame, MIME, or referrer policy. Primary file rows are pointer-only table
click targets, so keyboard and assistive-technology users cannot open files.

## Current state

- `apps/server/src/worker.ts:93-97` returns static assets directly.
- `apps/web/index.html` and `apps/admin/index.html` define no hardening policy.
- `apps/web/src/pages/FilesPage.tsx:683-704` and
  `ShareItemList.tsx:142-177` navigate only from `TableRow.onClick`.
- Secret-specific isolation/referrer ownership belongs to plan 012; do not
  duplicate token state here.

## Scope

**In scope**: production response headers, semantic file links/buttons, and
focus/keyboard behavior.

**Out of scope**: visual redesign and authorization changes.

## Steps

1. Inventory script/style/font/worker/blob/connect sources used by production.
   Define a least-privilege CSP plus `frame-ancestors`, `nosniff`, and explicit
   referrer policy at the Worker response boundary.
2. Keep development policy separate where Vite tooling requires it. Verify auth,
   PDF worker, CSV portal, blob URLs, and MCP/API requests under production CSP.
3. Render file names as semantic links/buttons to their detail routes. Preserve
   row-click convenience, selection controls, toggle-close behavior, and no
   nested-interactive invalid markup.

## Verification

- `pnpm --filter @keva/web build && pnpm typecheck && pnpm lint && pnpm format:check` -> pass.

## Done criteria

- Production documents receive verified hardening headers.
- File details are operable with keyboard and exposed as semantic controls.

## STOP conditions

- STOP if CSP requires broad `unsafe-eval`/`unsafe-inline`; identify the exact
  dependency and use nonce/hash or isolate it before weakening policy.

## Maintenance notes

Recheck CSP whenever adding analytics, fonts, workers, preview types, or external
connections.
