# Plan 003: Bring Worker Auth to Parity with Node

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- apps/server/src/worker.ts apps/server/src/node.ts apps/server/src/runtime.ts apps/server/src/better-auth.ts apps/server/src/app.ts apps/server/src/*.test.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: correctness, architecture
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

The architecture docs say Cloudflare Workers are the default runtime and Node is a first-class alternative. Today the Node entry wires Better Auth, session resolver, and `/api/auth/*`, while the Worker entry only creates the data-plane app with static/token auth. That means the web login/control-plane flow is not available in the Worker runtime, even though Workers are the stated target.

## Current state

- `apps/server/src/node.ts` wires Better Auth when `DATABASE_URL` and `BETTER_AUTH_SECRET` exist:

```ts
// apps/server/src/node.ts:39-47
const auth = process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET
  ? createBetterAuth({
      database: drizzle(postgres(process.env.DATABASE_URL), {
        schema: authSchema,
      }),
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL ?? baseUrl,
      trustedOrigins,
    })
  : undefined;
```

- `node.ts` passes both the session resolver and auth handler:

```ts
// apps/server/src/node.ts:59-68
...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
...(auth ? { sessionResolver: betterAuthSessionResolver(auth) } : {}),
...(s3 ? { s3 } : {}),
});

serve({
  fetch: createApp({
    layer,
    ...(auth ? { authHandler: auth.handler } : {}),
  }).fetch,
```

- `apps/server/src/worker.ts` does not import Better Auth and does not pass an auth handler:

```ts
// apps/server/src/worker.ts:35-44
const layer = makeRuntimeLayer({
  staticToken: env.KEVA_STATIC_TOKEN,
  tenantId: env.KEVA_TENANT_ID ?? "local",
  baseUrl: env.KEVA_BASE_URL,
  ...(env.HYPERDRIVE
    ? { databaseUrl: env.HYPERDRIVE.connectionString }
    : {}),
  ...(s3 ? { s3 } : {}),
});
app = createApp({ layer });
```

- Architecture guardrail: authenticate at the edge, authorize in core. Credentials should stay in `apps/server`, while core receives only `Principal`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server typecheck | `pnpm --filter @keva/server typecheck` | exit 0 |
| Server tests | `pnpm --filter @keva/server test` | all tests pass |
| Root typecheck optional | `pnpm --filter @keva/core typecheck && pnpm --filter @keva/schema typecheck && pnpm --filter @keva/sdk typecheck` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/worker.ts`
- `apps/server/src/node.ts` only to extract shared config helpers if needed
- `apps/server/src/better-auth.ts`
- `apps/server/src/runtime.ts`
- `apps/server/src/app.ts`
- `apps/server/src/*.test.ts` for focused coverage

**Out of scope**:
- Changing Better Auth table schema.
- Implementing OAuth/social providers.
- Web UI changes.
- Core authorization changes.
- Deployment config outside this repo.

## Git workflow

- Branch: `advisor/003-worker-auth-parity`
- Commit message style: plain imperative, for example `Wire Better Auth into Worker runtime`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add Worker env fields for Better Auth

In `apps/server/src/worker.ts`, extend `Env` with:

- `BETTER_AUTH_SECRET?: string`
- `BETTER_AUTH_URL?: string`
- `KEVA_TRUSTED_ORIGINS?: string`

Keep `HYPERDRIVE` as the source of the Postgres connection string in Workers.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0 after subsequent steps.

### Step 2: Build Better Auth in the Worker when database and secret exist

Mirror the Node behavior in Worker:

- If `env.HYPERDRIVE?.connectionString` and `env.BETTER_AUTH_SECRET` are present, create a postgres client with the Hyperdrive connection string.
- Create a Drizzle database with `authSchema`.
- Call `createBetterAuth`.
- Pass `betterAuthSessionResolver(auth)` to `makeRuntimeLayer`.
- Pass `auth.handler` to `createApp`.

Use the same base URL rule as Node: `env.BETTER_AUTH_URL ?? env.KEVA_BASE_URL`.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0.

### Step 3: Share trusted-origin parsing if duplication grows

If the Worker needs the same trusted-origin parsing as Node, extract a small pure helper inside `node.ts`/`worker.ts` or a new `apps/server/src/origins.ts`. Keep it simple:

```ts
const trustedOrigins = (baseUrl: string, configured?: string) => [
  baseUrl,
  ...(configured ? configured.split(",").map((o) => o.trim()).filter(Boolean) : []),
];
```

For local Node dev, preserve the existing default Vite origins unless you intentionally move them into the helper.

**Verify**: `pnpm --filter @keva/server typecheck` -> exit 0.

### Step 4: Add a focused Worker construction test

Add a test in `apps/server/src/app.test.ts` or a new `apps/server/src/worker.test.ts` that imports the Worker default export and calls `fetch` with an env object containing:

- `KEVA_STATIC_TOKEN`
- `KEVA_BASE_URL`
- optionally no `HYPERDRIVE` for the static-only path

The test should assert `/health` returns 200 and a static-token `/api/query` still works. If importing Worker with Better Auth + postgres is hard without a real DB, keep this test to the static-only path and add a separate pure test for the trusted-origin helper.

Do not introduce a fake secret value resembling a real token. Use placeholders only.

**Verify**: `pnpm --filter @keva/server test` -> all tests pass.

## Test plan

- Add a Worker static-mode smoke test so future changes do not break the entry point.
- Existing token/session tests in `apps/server/src/tokens.test.ts` cover the `sessionResolver` route through `TokenAndStaticAuthFromStoreLive`.
- Existing server integration tests cover the data-plane routes once the layer is constructed.

## Done criteria

- [ ] Worker env type supports Better Auth settings.
- [ ] Worker creates Better Auth and passes `authHandler` when Hyperdrive and Better Auth secret are configured.
- [ ] Worker passes `betterAuthSessionResolver(auth)` into `makeRuntimeLayer` in that same configured mode.
- [ ] Static-only Worker mode still works.
- [ ] `pnpm --filter @keva/server typecheck` exits 0.
- [ ] `pnpm --filter @keva/server test` exits 0.
- [ ] `plans/improvement/README.md` status row for plan 003 is updated.

## STOP conditions

Stop and report if:

- Better Auth cannot run in the Worker runtime with the currently imported package entry.
- `postgres` or Drizzle requires Node-only APIs in Workers despite Hyperdrive.
- Worker auth parity requires changing Better Auth schema or migrations.

## Maintenance notes

Reviewers should check that runtime-specific env access remains confined to `node.ts` and `worker.ts`. The core must continue receiving only `Principal`, never raw credentials or Better Auth objects.

