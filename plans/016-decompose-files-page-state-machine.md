# Plan 016: Decompose the files-page state machine

> **Executor instructions**: Run the drift check first. Preserve behavior and
> make one extraction at a time; do not rewrite the page.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/pages/FilesPage.tsx apps/web/src/components apps/web/src/lib`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plan 013
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

`FilesPage` is roughly 1,100 lines and owns route synchronization, filters,
queries, upload orchestration, cache writes, table selection, views, shares,
deletion, drag/drop, and responsive detail layout. Render-time state adjustment
at lines 347-387 is a symptom of unrelated state machines sharing one owner.

## Current state

- `apps/web/src/pages/FilesPage.tsx:298-387` initializes and reseeds route,
  filter, search, selection, view, share, upload, and drag state.
- Upload/cache orchestration is embedded at `466-516`; bulk deletion at
  `578-602`; table/navigation rendering at `654-720`.
- Direct `useEffect` is prohibited. Prefer keyed component ownership, derived
  state, events, `useSyncExternalStore`, or the repository's narrow
  `useMountEffect` for true mount cleanup.

## Scope

**In scope**: `FilesPage` plus focused colocated components/hooks for route/filter
state, upload queue, view commands, selection, and panes.

**Out of scope**: visual redesign, query semantics changes, and new abstractions
used by only one trivial call site.

## Steps

1. Introduce a keyed route/view boundary so route-owned state resets by identity
   rather than multiple `setState` calls during render.
2. Extract upload queue and cache policy consumers, then view mutations, then
   table/selection/pane components. Keep data ownership at the narrowest common
   parent and pass explicit events/results.
3. Remove duplicate query-key/cache logic in favor of plan 013 helpers.
4. Remove dead state/props immediately after each extraction.

## Verification

- `pnpm --filter @keva/web typecheck` -> exit 0.
- `pnpm lint && pnpm format:check` -> exit 0, including no-direct-use-effect.

## Done criteria

- No render-time state-reset block remains in `FilesPage`.
- Route/filter, upload, view, and selection responsibilities have explicit owners.
- `FilesPage` is primarily composition and page-level data flow.

## STOP conditions

- STOP if an extraction requires changing URL/query/cache behavior; split that
  behavior change into a separate plan.
- STOP if a proposed hook merely moves the same coupled state without narrowing
  ownership or API.

## Maintenance notes

Favor keyed boundaries and derived state over lifecycle synchronization. Review
new page responsibilities before allowing them back into the composition root.
