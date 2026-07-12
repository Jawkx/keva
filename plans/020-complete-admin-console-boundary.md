# Plan 020: Harden the local-only admin console

> **Executor instructions**: Run the drift check first. The admin console is a
> local operator tool and must not be included in Worker or consumer web
> deployments. Never ship its bearer token in a frontend bundle or repository.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/admin apps/server/src/admin.ts apps/server/src/app.ts apps/server/src/worker.ts apps/server/src/server-options.ts .github/workflows`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 003, 009, and 017
- **Category**: tech-debt
- **Planned at**: commit `ade6455`, 2026-07-12
- **Product decision**: local operator-only Node console; a separately protected
  deployment may be designed later

## Why this matters

A quota admin app exists but its supported operating model is unclear. It is a
local operator tool, not part of Keva's public Worker or consumer web app. Its UI
also allows stale requests to overwrite newer results or repopulate account data
after “Lock console.” Server quota operations target the first organization,
addressed by plan 009.

## Current state

- `apps/admin/src/main.tsx:24-35` lets every load update state without abort or
  generation checks; `40-45` does not invalidate in-flight work.
- `apps/admin/src/api.ts:11-23` stores the bearer token in component memory and
  decodes no response schema.
- `apps/server/src/worker.ts:10-25,56-81` has no admin token/config path.
- `apps/server/src/server-options.ts:56-70` mounts admin only when a Node-supplied
  token and database auth are present.

## Scope

**In scope**: a loopback-only admin UI and API, request cancellation,
session/token handling, organization-scoped API from plan 009, audit events, and
operator docs.

**Out of scope**: deploying admin assets or routes publicly, exposing admin
controls through the consumer app, storing an admin secret in localStorage, or
designing remote multi-operator access.

## Steps

1. Document one local workflow: start the admin Node API and Vite console on the
   operator's machine, bind both to loopback, provide database credentials and a
   short-lived runtime admin token, then stop both when finished.
2. Keep admin configuration and routes out of the Cloudflare Worker and admin
   assets out of the consumer web deployment. Fail closed if the local admin API
   would bind to a non-loopback interface.
3. Add AbortController or request generations so only the latest load may update
   state. “Lock console” must cancel or invalidate requests and clear the token
   and account data from memory.
4. Consume canonical schemas and organization-scoped quota APIs. Emit durable
   actor/target/before/after audit records for quota changes.

## Verification

- Local smoke check -> non-loopback exposure rejected, unauthorized access
  denied, and authorized read/update works.
- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Repository documentation and scripts implement one loopback-only admin model.
- Worker and consumer deployments contain no admin token, API configuration, or
  admin assets.
- Stale requests cannot restore or overwrite locked/newer UI state.
- Quota changes are organization-scoped, schema-decoded, and audited.

## STOP conditions

- STOP if the implementation requires exposing the console or admin API beyond
  loopback; that requires a new remote-access product and security decision.
- STOP if a long-lived token would be stored in a file, browser storage,
  frontend bundle, or repository.

## Maintenance notes

Future remote access should be a separately protected deployment with operator
identity, not a flag that makes this local bearer-token console public. Admin
mutations require authorization, auditability, and recovery together.
