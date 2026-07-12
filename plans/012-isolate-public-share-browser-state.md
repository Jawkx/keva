# Plan 012: Isolate public-share browser state and secrets

> **Executor instructions**: Run the drift check first. Never place the raw
> share token in logs, analytics, persisted storage, or test snapshots.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/pages/share apps/web/index.html apps/server/src/worker.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Navigating directly between two secret share URLs reuses one nested QueryClient
whose query keys omit the token. Cached identity, metadata, and preview bytes
from the first share can render in the second; `linkDead` also remains sticky.
Default same-origin referrer behavior can include the secret URL in asset/API
requests and infrastructure logs.

## Current state

- `apps/web/src/pages/share/SharePage.tsx:130-146` changes `ShareClient` by token
  but creates QueryClient and `linkDead` state only once.
- `SharePage.tsx:93`, `ShareItemList.tsx:63-75`, and
  `ShareFileDetail.tsx:47-66` use token-independent keys.
- `apps/web/index.html` and Worker static responses define no explicit referrer
  policy for `/s/:token`.

## Scope

**In scope**: public-share component lifetime, nested query cache, local state,
and referrer response policy.

**Out of scope**: owner-session query cache and rotating share tokens.

## Steps

1. Move token-owned QueryClient, dead-link state, selected item, uploads, and
   object URLs behind a component keyed by token so navigation fully disposes the
   prior share session.
2. Keep query keys scoped within that per-token client. If a namespace is still
   needed, use a non-reversible digest, never the token itself.
3. Clear/revoke token-owned preview resources when the session is disposed.
4. Set a restrictive referrer policy for secret-share documents/responses and
   verify downloads retain `noreferrer` behavior.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Each token has a fresh cache and local state lifetime.
- Raw share tokens do not enter cache keys, logs, referrers, or persisted storage.

## STOP conditions

- STOP if remounting causes active requests from the old token to write into the
  new cache; add cancellation/session ownership before proceeding.

## Maintenance notes

All future public-share state must live below the token-keyed boundary.
