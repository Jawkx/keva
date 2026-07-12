# Plan 022: Contain vendored viewer type and lifecycle debt

> **Executor instructions**: Run the drift check first. Treat registry code as
> an external boundary and avoid changing its internals without a concrete need.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/components/ui/pdf-viewer.tsx apps/web/src/components/ui/csv-viewer.tsx apps/web/src/components/ui/document-viewer-sidebar.tsx apps/web/src/components/FileDetail.tsx apps/web/src/pages/share/ShareFileDetail.tsx scripts/check-no-direct-use-effect.mjs`

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 015
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

The two largest stateful browser modules disable TypeScript entirely and are
excluded from the no-direct-useEffect rule. They contain asynchronous loading,
cancellation, selection, dynamic imports, and viewer state, so the claim that
all violations are type-only is not enforced.

## Current state

- `apps/web/src/components/ui/pdf-viewer.tsx:1-5` disables checking for about
  2,500 lines; lifecycle code starts at `186-205`.
- `csv-viewer.tsx:1-4` disables checking for about 830 lines.
- `scripts/check-no-direct-use-effect.mjs:7-14` excludes both viewers and related
  vendored files from the architecture rule.
- The headers instruct future registry updates to re-add suppression, making the
  debt self-perpetuating.

## Scope

**In scope**: typed adapters, pinned registry provenance/version, incremental
suppression reduction, and explicit lint-rule boundary.

**Out of scope**: rewriting PDF/CSV viewers or altering their visual design.

## Steps

1. Record registry source/version and an update procedure that diffs upstream
   before replacement.
2. Introduce small owned, typed adapter components exposing only Keva-used props
   and lifecycle. Lazy-load vendored implementations behind them.
3. Remove file-wide `@ts-nocheck` incrementally. Prefer upstream types and narrow
   casts; if full typing is uneconomical, exclude vendored source via tsconfig
   while keeping adapters fully checked and document the boundary honestly.
4. Narrow no-use-effect exclusions to true vendored files; owned adapters must
   obey repository conventions.

## Verification

- `pnpm --filter @keva/web typecheck` -> owned adapters fully checked; suppression count reduced/documented.
- `pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Keva code imports typed owned adapters, not registry implementations directly.
- Vendored provenance and remaining unchecked boundary are explicit and minimal.

## STOP conditions

- STOP if removing suppression requires behavior changes outside the typed
  adapter boundary.
- STOP if a registry refresh overwrites owned adapters; separate directories and
  update tooling first.

## Maintenance notes

Review upstream updates as third-party code changes, including licenses,
security, bundle size, and lifecycle behavior.
