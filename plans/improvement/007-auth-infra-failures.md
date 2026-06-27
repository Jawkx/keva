# Plan 007: Surface Session Infrastructure Failures as 5xx

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- apps/server/src/auth.ts apps/server/src/tokens.test.ts apps/server/src/app.test.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness, operability
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

When session resolution fails because the auth database or Better Auth layer is unavailable, the current strategy silently returns `null`. The request then falls through to `Unauthorized`, causing users to be bounced to login even though their credential may be fine. Infrastructure failures should surface as typed 5xx errors, not as invalid credentials.

## Current state

- The auth strategy type already allows `StorageUnavailable`:

```ts
// apps/server/src/auth.ts:29-31
type AuthStrategy = (
  request: AuthRequest,
) => Effect.Effect<Principal | null, StorageUnavailable>;
```

- Token-store failures intentionally become `StorageUnavailable`:

```ts
// apps/server/src/auth.ts:168-172
// A failed token-store query is infrastructure unavailability, not a bad
// credential: surface StorageUnavailable (-> 502) instead of swallowing it
// into a 401 (resolve) or an opaque 500 (mint/list/revoke).
const storageError = (): StorageUnavailable =>
  new StorageUnavailable({ message: "Token storage unavailable" });
```

- Session resolver failures are swallowed:

```ts
// apps/server/src/auth.ts:323-338
export const sessionStrategy = (
  resolve: SessionResolver,
): AuthStrategy =>
  ({ headers }) =>
    Effect.promise(() => resolve(headers)).pipe(
      Effect.map((session) =>
        session
          ? {
              tenantId: session.tenantId,
              scopes: [...(session.scopes ?? ["read", "write", "delete", "admin"])],
              via: "session" as const,
            }
          : null
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    );
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server typecheck | `pnpm --filter @keva/server typecheck` | exit 0 |
| Server tests | `pnpm --filter @keva/server test` | all tests pass |

## Scope

**In scope**:
- `apps/server/src/auth.ts`
- `apps/server/src/tokens.test.ts`
- `apps/server/src/app.test.ts` or a new server auth test

**Out of scope**:
- Better Auth schema changes.
- Web UI error handling changes.
- Token storage behavior, except to keep it consistent.
- Changes to `statusFor`; `StorageUnavailable` already maps to 502.

## Git workflow

- Branch: `advisor/007-auth-infra-failures`
- Commit message style: plain imperative, for example `Surface session auth failures`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Stop swallowing resolver exceptions

In `sessionStrategy`, replace `Effect.promise(...).pipe(... Effect.catchAll(() => Effect.succeed(null)))` with `Effect.tryPromise` whose catch maps to:

```ts
new StorageUnavailable({ message: "Session storage unavailable" })
```

Preserve the existing successful-session mapping to `Principal`.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0 after imports are fixed.

### Step 2: Avoid turning missing-cookie requests into infrastructure checks

Before calling the session resolver, short-circuit to `Effect.succeed(null)` when the request has no `cookie` header. This keeps unauthenticated API requests as 401 and avoids hitting Better Auth/DB unnecessarily.

If Better Auth session auth can use non-cookie headers in this app, STOP and report. Current web code uses cookie sessions.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0.

### Step 3: Add tests for three auth outcomes

In `apps/server/src/tokens.test.ts` or a new auth-focused server test, build an app with `TokenAndStaticAuthFromStoreLive` and a custom `sessionResolver`.

Add tests:

- No cookie and no bearer token -> `/api/query` returns 401 Unauthorized.
- Cookie present and resolver throws -> `/api/query` returns 502 with `_tag: "StorageUnavailable"`.
- Cookie present and resolver returns a session -> existing admin/session flow still works.

Follow the existing in-memory test style in `tokens.test.ts`.

**Verify**: `pnpm --filter @keva/server test` -> all tests pass.

## Test plan

- Add focused server tests for missing cookie, thrown session resolver, and successful session.
- Existing tests should continue covering static token auth, minted token auth, scope enforcement, and token management.

## Done criteria

- [ ] Session resolver thrown errors become `StorageUnavailable`.
- [ ] Requests with no session cookie can still return 401 instead of 502.
- [ ] Existing valid session behavior is unchanged.
- [ ] `pnpm --filter @keva/server typecheck` exits 0.
- [ ] `pnpm --filter @keva/server test` exits 0.
- [ ] `plans/improvement/README.md` status row for plan 007 is updated.

## STOP conditions

Stop and report if:

- Better Auth sessions in this app are not cookie-based.
- Changing session failure handling causes token-auth requests with invalid tokens to return 502 when no cookie is present.
- `StorageUnavailable` mapping no longer returns 502 in `@keva/schema`.

## Maintenance notes

Reviewers should check error taxonomy consistency: bad credentials are 401, authenticated-but-disallowed is 403, auth infrastructure unavailable is 502.

