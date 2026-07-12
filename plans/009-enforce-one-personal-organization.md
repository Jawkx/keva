# Plan 009: Enforce one personal organization per user

> **Executor instructions**: Run the drift check first. Keva currently supports
> exactly one hidden personal organization per user. Preserve the organization
> tenant model for future multi-organization support, but do not expose or infer
> organization switching now.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/server/src/better-auth.ts apps/server/src/admin.ts apps/server/src/auth-schema.ts apps/server/src/mcp.ts packages/schema/src/index.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: plan 003
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12
- **Product decision**: one hidden personal organization now; multiple
  organizations and switching may be added later

## Why this matters

Keva currently gives each user one collection of files, views, shares, tokens,
and quota. Internally that collection is a Better Auth organization, but browser
sessions, MCP, and admin resolve it differently. Enforcing one canonical personal
organization removes that ambiguity while keeping organization IDs as the tenant
boundary for future multi-organization support.

## Current state

- `apps/server/src/better-auth.ts:123-165` accepts
  `activeOrganizationId` and returns full scopes; membership is consulted only
  when no active organization is present.
- `better-auth.ts:169-179` resolves MCP to the earliest membership.
- `apps/server/src/admin.ts:52-105` displays and updates the earliest membership.
- `apps/server/src/auth-schema.ts` permits roles and multiple memberships.

## Scope

**In scope**: personal-organization bootstrap, one canonical resolver,
session/MCP/admin tenant selection, ownership validation, stale active-org
handling, and blocking unsupported organization-management operations.

**Out of scope**: organization creation/switching UI, invitations, shared
organization membership, non-owner role permissions, and credentials bound to a
user-selected organization.

## Steps

1. Add one personal-organization resolver keyed by user ID. It must return the
   user's canonical personal organization, create it once when absent, and
   confirm the user is its owner. Do not select the first membership.
2. Use that resolver for browser sessions. If `activeOrganizationId` is absent or
   points elsewhere, restore the canonical personal organization.
3. Use the same resolver for MCP and admin operations. Admin quota changes must
   target that explicit organization ID rather than the earliest membership.
4. Prevent users from creating, joining, inviting to, or switching organizations
   through Better Auth while those features are unsupported. Keep only the
   server-controlled personal-organization bootstrap path.
5. Grant Keva scopes only after confirming ownership of the canonical personal
   organization. Treat any additional membership as unsupported data, not as
   another selectable tenant.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Each user resolves to one canonical personal organization.
- No runtime path selects the first membership or trusts an unrelated active
  organization.
- Browser, MCP, and admin agree on the same organization ID.
- User-facing organization creation, joining, invitations, and switching remain
  unavailable until intentionally implemented.

## STOP conditions

- STOP if production data contains intentional additional organizations or
  non-owner members; report that data before enforcing the personal-only rule.
- STOP if Better Auth cannot block user organization management while retaining
  server-controlled bootstrap; isolate bootstrap behind a dedicated internal
  path rather than leaving all organization endpoints open.

## Maintenance notes

The personal organization remains a normal organization row. Future
multi-organization support can add membership roles, selection UI, and
organization-bound credentials without moving existing files or views. Replace
this resolver deliberately at that point rather than adding another fallback.
