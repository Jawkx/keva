# Plan 007: Make view and share mutations consistent

> **Executor instructions**: Run the drift check first. Use one server-side
> transaction; frontend compensation is not an acceptable primary fix. Reject a
> view edit that would make an active write grant incompatible.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/server/src/app.ts apps/server/src/views.ts apps/server/src/shares.ts packages/schema/src/index.ts packages/core/src/postgres/schema.ts packages/core/drizzle apps/web/src/components/ShareCreateDialog.tsx`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plan 003
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12
- **Product decision**: reject incompatible view edits until affected write
  grants are revoked

## Why this matters

Creating a share from unsaved filters can leave orphan views when the second
request fails. Editing a view can also invalidate existing write stamps, causing
uploads that immediately fall outside their own share. These are one aggregate
split across independent store calls.

## Current state

- `apps/web/src/components/ShareCreateDialog.tsx:122-134` creates a view, exposes
  it in cache, then separately creates the share.
- `apps/server/src/app.ts:537-566` validates write-stamp compatibility only when
  creating a grant.
- `apps/server/src/app.ts:508-519` updates view conditions without checking live
  write grants.
- `apps/server/src/shares.ts:121-140` resolves current view conditions with the
  previously stored stamp.

## Scope

**In scope**: transactional server commands for create-view-with-share and
condition updates, store APIs, shared request schemas, and UI call site.

**Out of scope**: changing read shares' documented live-view behavior unless a
product decision explicitly chooses snapshots for all grants.

## Steps

1. Define aggregate invariants: read shares may follow live conditions; every
   write share's stamp must satisfy current conditions and only property keys.
2. Add one transactional command to create the optional backing view and grant.
   Return both records/token only after commit.
3. On condition update, lock/load affected write grants and reject an
   incompatible edit with a typed actionable error. Identify the affected grants
   so the UI can tell the user which upload links must be revoked first. Do not
   revoke or replace grants automatically.
4. Switch `ShareCreateDialog` to the aggregate endpoint and invalidate caches
   only after success.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Share creation cannot leave an unintended backing view.
- A committed view edit cannot invalidate an active write grant.
- An incompatible edit leaves both the view and its write grants unchanged and
  tells the user to revoke the affected upload links first.
- Read-share live-filter semantics remain unchanged.

## STOP conditions

- STOP if transaction support is bypassed with client cleanup calls.

## Maintenance notes

Future view fields that affect grant enforcement belong in the same aggregate
transaction.
