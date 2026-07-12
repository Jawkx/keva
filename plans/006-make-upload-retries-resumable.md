# Plan 006: Make upload retries resume the existing item

> **Executor instructions**: Run the drift check first. Preserve the initiated
> item and upload phase across retries; do not add persistent idempotency storage.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/sdk/src/index.ts apps/web/src/pages/FilesPage.tsx apps/web/src/pages/share/ShareUploadZone.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 002
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Upload retry restarts initiation, so a lost confirmation response can create a
duplicate permanent item. The SDK hides initiate, PUT, and confirm behind one
promise, leaving the UI without the item ID and failed phase needed to resume.

## Current state

- `packages/sdk/src/index.ts:181-191` and `431-450` hide initiate/PUT/confirm in
  one non-resumable call.
- `apps/web/src/pages/FilesPage.tsx:466-515` and
  `ShareUploadZone.tsx:43-78` retry the entire helper.
- `packages/core/src/engine.ts:186-210` already makes confirmation idempotent: a
  retry against an item that became ready returns that same item.

## Scope

**In scope**: SDK resumable upload phases and owner/share UI retry state.

**Out of scope**: delete semantics, multipart upload, cross-reload/cross-device
resume, and persistent client operation IDs.

## Steps

1. Expose SDK phase primitives or an upload-session result that preserves the
   initiated item ID, signed request, and whether failure occurred during PUT or
   confirmation. Keep the existing convenience upload method for simple callers.
2. Store that session/phase in owner and share upload rows. Retry PUT with the
   same signed staging request after a PUT failure, and retry `confirm(itemId)`
   directly after a confirmation failure.
3. If a signed request expires before PUT succeeds, start a new initiation and
   let the existing pending-item cleanup reclaim the abandoned item. Never start
   a new initiation merely because confirmation failed.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Retrying one logical upload cannot create a second item.
- A lost confirmation response resumes confirmation for the original item.
- The change requires no schema migration or persistent idempotency table.

## STOP conditions

- STOP if the implementation cannot distinguish PUT failure from confirmation
  failure; expose a structured SDK phase result instead of parsing error text.
- STOP if requirements expand to reload/device-independent resume; design a
  persistent idempotency contract as a separate plan.

## Maintenance notes

Keep the convenience upload API implemented through the same phase primitives so
owner and share behavior cannot drift.
