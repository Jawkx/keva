# Plan 015: Bound and lazy-load preview resources

> **Executor instructions**: Run the drift check first. Measure production
> chunks and retained bytes before and after; do not add memoization by default.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/router.tsx apps/web/src/components/FileDetail.tsx apps/web/src/pages/share/ShareFileDetail.tsx apps/web/src/lib/object-url-cache.ts apps/web/src/lib/preview.ts apps/web/src/components/ui apps/web/vite.config.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

The initial bundle statically imports every route plus large PDF/CSV viewers.
Preview queries retain raw bytes and duplicate blobs indefinitely, while object
URLs are bounded by entry count rather than bytes. Browsing several 25 MB PDFs
can retain hundreds of megabytes.

## Current state

- `apps/web/src/router.tsx:1-12` statically imports all pages.
- `FileDetail.tsx:18-20` and `ShareFileDetail.tsx:6-10` statically import heavy
  viewer modules.
- Both detail components cache `{ bytes, blob }` with `staleTime: Infinity`.
- `apps/web/src/lib/object-url-cache.ts:1-20` retains 12 entries regardless of
  size; `preview.ts:6-8` allows PDFs up to 25 MB.

## Scope

**In scope**: route/viewer lazy boundaries, preview representation, byte-aware
cache ownership/eviction, object URL lifecycle, loading/error states, and
bundle measurement.

**Out of scope**: replacing PDF/CSV libraries (plan 022) and server thumbnails.

## Steps

1. Capture baseline Vite chunk sizes and a repeatable preview-retention scenario.
2. Lazy-load route elements and PDF/CSV viewers only after route/content type is
   known, with existing skeleton/error UX preserved.
3. Store only the representation a renderer needs; avoid simultaneous raw-byte
   and blob copies for image/PDF. Decode bounded text/CSV without retaining extra
   buffers.
4. Give preview cache a byte budget and explicit viewer/session ownership.
   Revoke URLs when evicted, deleted, or public-share session changes, while
   preserving active viewers and StrictMode remounts.

## Verification

- `pnpm --filter @keva/web build` -> separate route/PDF/CSV chunks; initial chunk shrinks from baseline.
- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Login/settings/non-preview routes do not load viewer implementations.
- Retained preview data obeys a documented byte budget.
- Object URLs are revoked exactly when no active owner/cache entry needs them.

## STOP conditions

- STOP if lazy loading duplicates the PDF engine per preview; preserve a safe
  shared engine boundary.
- STOP if eviction can revoke an URL rendered by an active viewer.

## Maintenance notes

Track preview limits and cache budget together. New preview types require an
explicit retention cost and lazy import.
