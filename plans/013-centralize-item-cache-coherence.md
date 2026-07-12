# Plan 013: Centralize item mutation cache coherence

> **Executor instructions**: Run the drift check first. Implement one
> cache-maintenance API; do not add more scattered invalidations to components.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/components/FileDetail.tsx apps/web/src/pages/FilesPage.tsx apps/web/src/pages/share/ShareUploadZone.tsx apps/web/src/lib/items-cache.ts apps/web/src/lib/use-property-suggestions.ts apps/web/src/lib/object-url-cache.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Each mutation manually updates a different subset of React Query caches.
Deletion leaves metadata/content/history available, property mutations leave
suggestions stale, and share uploads leave usage stale. The root issue is cache
policy spread across page components.

## Current state

- `apps/web/src/components/FileDetail.tsx:152-175` updates list and usage state on
  delete, while patch separately invalidates events; delete does not remove the
  item/content/event caches or invalidate suggestions.
- `apps/web/src/pages/FilesPage.tsx:466-591` has separate upload and bulk-delete
  cache logic with the same omissions.
- `apps/web/src/lib/use-property-suggestions.ts:6-30` defines three key families
  with 60-second freshness.
- `ShareUploadZone.tsx:43-48` invalidates share items but not `share-self` usage.

## Scope

**In scope**: query-key factories, centralized item/share cache operations,
mutation call sites, and object URL eviction hooks.

**Out of scope**: changing server response shapes and preview byte limits
(plan 015).

## Steps

1. Define typed key factories for item, content, events, lists, usage, property
   summaries/keys/values, and public-share state.
2. Implement focused cache operations for confirmed upload, patch, delete-many,
   and share upload. Each operation must document update vs invalidate vs remove.
3. On permanent delete, remove metadata/content/event entries and revoke object
   URLs for every confirmed-deleted ID, including bulk results.
4. Invalidate or update property discovery after metadata-changing uploads,
   patches, and deletes. Refresh `share-self` after confirmed share uploads.
5. Replace component-local key literals, including partial bulk-delete handling.

## Verification

- `pnpm --filter @keva/web typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Mutation components call shared cache operations rather than hand-maintaining
  key families.
- Deleted bytes/metadata cannot render from cache.
- Property suggestions and share usage converge immediately after success.

## STOP conditions

- STOP if a cache operation needs token/session data unavailable at its boundary;
  make ownership explicit rather than import component globals.

## Maintenance notes

New mutation endpoints must define their cache policy before UI integration.
