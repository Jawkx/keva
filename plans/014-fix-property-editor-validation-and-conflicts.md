# Plan 014: Fix property editor validation and conflict handling

> **Executor instructions**: Run the drift check first. Preserve active user
> drafts; never “synchronize” by blindly overwriting dirty input.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/web/src/lib/properties.ts apps/web/src/components/PropertiesEditor.tsx apps/web/src/components/ShareCreateDialog.tsx packages/schema/src`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plan 017
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Invalid numeric input silently becomes zero, client validation disagrees with
the canonical schema, and editor drafts never reconcile with authoritative
refetches. A stale JSON draft can overwrite newer metadata from another client.

## Current state

- `apps/web/src/lib/properties.ts:20-26` maps every non-finite number to `0`.
- `properties.ts:48-61` omits the 8 KB string limit and rejects empty arrays that
  `@keva/schema` accepts.
- `PropertiesEditor.tsx:332-348` seeds row state/last committed value only once;
  rows are keyed by property name at `481-490`.
- `PropertiesEditor.tsx:511-525` seeds JSON text once while diffing against
  changing props.

## Scope

**In scope**: UI coercion result types, canonical schema issue mapping, clean/
dirty/conflicted draft state, row/JSON conflict UX, and share-stamp validation.

**Out of scope**: server transaction limits (plan 005) and generic form redesign.

## Steps

1. Consume validation helpers exported by plan 017. Keep UI parsing separate but
   return `{ ok, value/error }`; never invent a fallback value.
2. Block empty/non-finite numeric commits and show a field-level error in row,
   add-row, JSON, and share-stamp editors.
3. Model draft state as clean, dirty, saving, or conflicted with an authoritative
   revision/baseline. Reseed clean drafts on server updates; preserve dirty drafts
   and surface conflict resolution when the baseline changes.
4. After successful save, update baseline from the server result, not the
   submitted draft. Roll back failed optimistic markers without losing input.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Invalid input is rejected visibly and never saved as zero.
- Web and server agree on every property validity boundary.
- Authoritative updates do not leave stale clean fields or silently overwrite
  dirty fields.

## STOP conditions

- STOP if no reliable item revision exists for conflict detection; add/derive an
  explicit revision contract rather than comparing formatted JSON only.

## Maintenance notes

Future editors/importers must consume the canonical validator and define their
own explicit coercion UX.
